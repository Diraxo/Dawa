-- Migration 075: stop confirmed bookings from silently unlocking their slot
--
-- Root cause of the release-blocking bug ("booked slot still shows as
-- Available, even to the patient who booked it"):
--
-- slot_locks.expires_at defaults to `now() + interval '10 minutes'`
-- (migration 019) — it was designed as a short-lived hold while a payment is
-- in flight. Every client screen that decides Available/Booked (BookingModal,
-- RescheduleModal, both platforms) and the server's own is_slot_available()
-- treat "expires_at > now()" as the entire definition of "booked". But
-- nothing anywhere ever extends or clears that TTL once the booking is
-- actually confirmed (chapa-webhook flips consultations.status to 'scheduled'
-- / 'waiting_for_doctor' but never touches slot_locks; the full-credit path
-- via the apply-credit edge function does the same). The result: exactly 10
-- minutes after ANY booking — paid or free-via-credit, scheduled or on-demand
-- — its slot_locks row quietly expires and the slot reopens as Available to
-- everyone, including the owning patient, while the consultation itself is
-- still very much active. reschedule_appointment_slot() has the identical
-- gap: the new slot_locks row it inserts also gets the bare 10-minute
-- default, so a rescheduled appointment unlocks itself again 10 minutes
-- later too.
--
-- Fix, at the root rather than patching every call site that can flip a
-- consultation's status (there are several, across two edge functions and
-- both client apps):
--
-- 1. A trigger on consultations that, on any status change, keeps slot_locks
--    in sync with what the appointment actually means:
--      - status reaches an active/confirmed state (anything other than the
--        transient 'pending_payment' hold) -> extend that consultation's
--        slot_locks row to expires_at = 'infinity' so it can never silently
--        lapse while the appointment is live.
--      - status reaches a released state (cancelled/declined/call_declined/
--        no_show/missed/doctor_missed/ended_abnormally — the same terminal
--        set migration 044's uq_consultations_doctor_slot index already
--        excludes) -> delete the slot_locks row immediately, freeing the
--        slot for other patients without waiting on any TTL.
--    Being trigger-based, this covers every current and future write path
--    (webhook, edge function, direct client update) uniformly.
--
-- 2. reschedule_appointment_slot() inserts its new slot_locks row with
--    expires_at = 'infinity' directly — a reschedule never passes through
--    'pending_payment' (the consultation stays 'scheduled' throughout), so
--    the trigger above never fires for it and it needs the same treatment
--    inline.
--
-- 3. One-time backfill: any consultation already sitting in a confirmed
--    state right now whose slot_locks row already lapsed under the old
--    behavior gets its lock restored immediately, so already-booked
--    appointments don't remain double-bookable until a client happens to
--    write to them again.

-- ── 1. Keep slot_locks in sync with consultation status ─────────────────────
CREATE OR REPLACE FUNCTION public.sync_slot_lock_on_status_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status THEN
    IF NEW.status IN ('cancelled', 'declined', 'call_declined', 'no_show', 'missed', 'doctor_missed', 'ended_abnormally') THEN
      DELETE FROM public.slot_locks WHERE consultation_id = NEW.id;
    ELSIF NEW.status <> 'pending_payment' THEN
      UPDATE public.slot_locks SET expires_at = 'infinity' WHERE consultation_id = NEW.id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_slot_lock_on_status_change ON public.consultations;
CREATE TRIGGER trg_sync_slot_lock_on_status_change
  AFTER UPDATE ON public.consultations
  FOR EACH ROW EXECUTE FUNCTION public.sync_slot_lock_on_status_change();

-- ── 2. reschedule_appointment_slot(): new lock is permanent from the start ──
-- Same signature/body as migration 065 (CREATE OR REPLACE in place) — only
-- change is the explicit expires_at on the new slot_locks insert.
CREATE OR REPLACE FUNCTION public.reschedule_appointment_slot(
  p_consultation_id uuid,
  p_new_slot_start  timestamptz
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_row              public.consultations%ROWTYPE;
  v_avail            jsonb;
  v_doctor_status    text;
  v_duration         int;
BEGIN
  DELETE FROM public.slot_locks WHERE expires_at < now();

  IF p_new_slot_start < now() - interval '2 minutes' THEN
    RAISE EXCEPTION 'SLOT_EXPIRED: This time slot has already passed.';
  END IF;

  SELECT * INTO v_row FROM public.consultations WHERE id = p_consultation_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: Consultation not found.';
  END IF;

  IF v_row.patient_id IS DISTINCT FROM public.get_user_id_from_jwt_sub() THEN
    RAISE EXCEPTION 'FORBIDDEN: You can only reschedule your own appointments.';
  END IF;

  IF v_row.status IS DISTINCT FROM 'scheduled' THEN
    RAISE EXCEPTION 'INVALID_STATUS: Only scheduled appointments can be rescheduled.';
  END IF;

  SELECT availability, status INTO v_avail, v_doctor_status
  FROM public.doctor_profiles WHERE id = v_row.doctor_id;

  IF v_doctor_status IS DISTINCT FROM 'approved' THEN
    RAISE EXCEPTION 'DOCTOR_UNAVAILABLE: This doctor is not currently available for booking.';
  END IF;

  SELECT slot_duration INTO v_duration
  FROM public.slot_locks
  WHERE consultation_id = p_consultation_id
  LIMIT 1;
  v_duration := COALESCE(v_duration, 20);

  IF v_avail IS NOT NULL THEN
    PERFORM public._validate_scheduled_slot(v_avail, p_new_slot_start, v_duration);
  END IF;

  -- expires_at = 'infinity': this is a confirmed appointment moving slots,
  -- never a payment hold, so the new lock must not be subject to the
  -- 10-minute default TTL slot_locks otherwise carries.
  BEGIN
    INSERT INTO public.slot_locks (doctor_id, slot_start, slot_duration, consultation_id, expires_at)
    VALUES (v_row.doctor_id, p_new_slot_start, v_duration, p_consultation_id, 'infinity');
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'SLOT_TAKEN: This time slot is no longer available.';
  END;

  DELETE FROM public.slot_locks
  WHERE consultation_id = p_consultation_id
    AND slot_start = v_row.scheduled_at;

  UPDATE public.consultations
  SET scheduled_at           = p_new_slot_start,
      previous_scheduled_at  = v_row.scheduled_at,
      reminder_30_sent       = false,
      reminder_10_sent       = false,
      reminder_5_sent        = false,
      notification_sent      = false
  WHERE id = p_consultation_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.reschedule_appointment_slot(uuid, timestamptz) TO authenticated;

-- ── 3. Backfill: repair locks for already-confirmed live consultations ──────
UPDATE public.slot_locks sl
SET expires_at = 'infinity'
FROM public.consultations c
WHERE sl.consultation_id = c.id
  AND c.status NOT IN ('pending_payment', 'cancelled', 'declined', 'call_declined', 'no_show', 'missed', 'doctor_missed', 'ended_abnormally')
  AND sl.expires_at <> 'infinity';

-- Also drop any lingering lock rows for consultations that already reached a
-- released state before this migration existed to sync them.
DELETE FROM public.slot_locks sl
USING public.consultations c
WHERE sl.consultation_id = c.id
  AND c.status IN ('cancelled', 'declined', 'call_declined', 'no_show', 'missed', 'doctor_missed', 'ended_abnormally');

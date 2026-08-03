-- Migration 104: Phase 4 scheduling audit (2026-07-30) — Critical + High fixes
--
-- Fixes the two Critical findings and the schema/RPC half of all five High
-- findings. H1 and H4 each also require an edge-function code change
-- (apply-credit and chapa-webhook respectively), shipped in the same
-- release as this migration but not part of it.
--
--   C1. consultations_update RLS (migration 002) has no WITH CHECK — any
--       owner can rewrite patient_id/doctor_id/type/is_on_demand/
--       scheduled_at/waiting_started_at to anything. Closed with a guard
--       trigger mirroring the established pattern (089/094/098).
--   C2. Cancelling a paid 'scheduled' consultation forfeits payment —
--       set_consultation_credit_on_decline() never had 'scheduled' in its
--       OLD.status allow-list. Also adds a real patient-facing cancel
--       transition for that status (client UI change ships alongside this
--       migration).
--   H1. apply-credit's partial-coverage branch only reserved a credit
--       (replacement_consultation_id) without claiming it (credit_used),
--       so an abandoned partial-credit booking left the credit re-offerable
--       on a second booking — double-spend if both later completed. The
--       edge function now claims atomically at reservation time (mirroring
--       its own full-coverage branch); this migration extends the existing
--       stale-pending-payment sweep to release that claim if the booking is
--       itself abandoned, so the credit isn't lost forever either.
--   H2. slot_locks INSERT policy is `WITH CHECK (true)` — any authenticated
--       user can grief any doctor's calendar. Dropped; no legitimate call
--       site needs it (booking always goes through the SECURITY DEFINER
--       RPCs, which bypass RLS as the table owner).
--   H5. book_appointment_slot()/reschedule_appointment_slot() never
--       enforced grid alignment or a fixed slot duration — a direct RPC
--       call with an off-grid start time or non-standard duration could
--       create genuinely overlapping consultations. Added to
--       _validate_scheduled_slot().

-- ── C1a: guard trigger for identity/schedule columns ─────────────────────────
--
-- patient_id/doctor_id/type/is_on_demand: no legitimate call site (client or
-- server) ever updates these post-creation — always blocked for a direct
-- top-level client write.
--
-- scheduled_at/previous_scheduled_at: only reschedule_appointment_slot()
-- legitimately writes these, from the patient's own authenticated session.
-- It sets carehub.consultations_reschedule_write='on' (transaction-local)
-- immediately before its UPDATE so this trigger can distinguish that call
-- from a direct PATCH.
--
-- waiting_started_at: written from three legitimate places —
--   1. Server-side crons/cascades (trigger_appointment_notifications,
--      _activate_next_queued_for_doctor, ...) — auth.role() IS NULL there
--      (no PostgREST context) or the transaction already carries
--      carehub.system_status_write='on' (migration 092/101's flag for the
--      same reason).
--   2. reschedule_appointment_slot() itself does not touch this column, but
--      shares the same bypass flag for simplicity.
--   3. app/(patient)/payment-return.tsx (+ its web mirror) flips a
--      pending_payment -> waiting_for_doctor row to stamp "waiting since"
--      after confirming payment client-side. Allowed only for that exact
--      narrow transition (OLD.status='pending_payment', NEW.status=
--      'waiting_for_doctor', NEW.payment_status='paid') — payment_status can
--      only be 'paid' here because migration 089's financial-column guard
--      (trg_00_..., alphabetically first) already blocks any non-service-role
--      caller from setting it themselves, so reaching 'paid' proves a prior
--      service-role write already happened.
CREATE OR REPLACE FUNCTION public.guard_consultation_identity_and_schedule_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.role() IS NULL OR auth.role() = 'service_role' OR public.is_admin() THEN
    RETURN NEW;
  END IF;

  IF NEW.patient_id IS DISTINCT FROM OLD.patient_id
     OR NEW.doctor_id IS DISTINCT FROM OLD.doctor_id
     OR NEW.type IS DISTINCT FROM OLD.type
     OR NEW.is_on_demand IS DISTINCT FROM OLD.is_on_demand
  THEN
    RAISE EXCEPTION 'FORBIDDEN: This field cannot be changed after booking.';
  END IF;

  IF (NEW.scheduled_at IS DISTINCT FROM OLD.scheduled_at
      OR NEW.previous_scheduled_at IS DISTINCT FROM OLD.previous_scheduled_at)
     AND current_setting('carehub.consultations_reschedule_write', true) IS DISTINCT FROM 'on'
  THEN
    RAISE EXCEPTION 'FORBIDDEN: scheduled_at can only be changed via reschedule_appointment_slot().';
  END IF;

  IF NEW.waiting_started_at IS DISTINCT FROM OLD.waiting_started_at
     AND current_setting('carehub.system_status_write', true) IS DISTINCT FROM 'on'
     AND current_setting('carehub.consultations_reschedule_write', true) IS DISTINCT FROM 'on'
     AND NOT (
       OLD.status = 'pending_payment'
       AND NEW.status = 'waiting_for_doctor'
       AND NEW.payment_status = 'paid'
     )
  THEN
    RAISE EXCEPTION 'FORBIDDEN: waiting_started_at cannot be modified directly.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_00_guard_consultation_identity_columns ON public.consultations;
CREATE TRIGGER trg_00_guard_consultation_identity_columns
  BEFORE UPDATE ON public.consultations
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_consultation_identity_and_schedule_columns();

-- ── C1b: reschedule_appointment_slot() sets the bypass flag ──────────────────
-- Same body as migration 075 (CREATE OR REPLACE in place); only change is
-- the set_config() calls bracketing the final UPDATE.
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

  PERFORM set_config('carehub.consultations_reschedule_write', 'on', true);

  UPDATE public.consultations
  SET scheduled_at           = p_new_slot_start,
      previous_scheduled_at  = v_row.scheduled_at,
      reminder_30_sent       = false,
      reminder_10_sent       = false,
      reminder_5_sent        = false,
      notification_sent      = false
  WHERE id = p_consultation_id;

  PERFORM set_config('carehub.consultations_reschedule_write', 'off', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.reschedule_appointment_slot(uuid, timestamptz) TO authenticated;

-- ── C2a: credit issuance must also cover a cancelled paid 'scheduled' row ────
-- Same body as migration 062 (CREATE OR REPLACE in place); only change is
-- adding 'scheduled' to the OLD.status allow-list, matching
-- 'waiting_for_doctor' since both represent a paid, not-yet-resolved booking.
CREATE OR REPLACE FUNCTION public.set_consultation_credit_on_decline()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status
     AND COALESCE(NEW.payment_status, OLD.payment_status) = 'paid'
     AND NOT COALESCE(NEW.consultation_credit, false)
     AND (
       NEW.status = 'declined'
       OR (NEW.status = 'cancelled' AND OLD.status IN ('pending_payment', 'waiting_for_doctor', 'scheduled'))
     )
  THEN
    NEW.consultation_credit := true;
    NEW.credit_amount := COALESCE(NEW.patient_amount, OLD.patient_amount, 0);
  END IF;
  RETURN NEW;
END;
$function$;

-- ── C2b: allow a patient to self-cancel a 'scheduled' (paid, future) row ─────
-- Same body as migration 097 (current version, CREATE OR REPLACE in place);
-- only change is one new allowed patient transition.
CREATE OR REPLACE FUNCTION public.guard_consultation_status_transitions()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_user_id   uuid;
  v_caller_doctor_id uuid;
  v_is_patient       boolean;
  v_is_doctor        boolean;
BEGIN
  IF auth.role() IS NULL OR auth.role() = 'service_role' OR public.is_admin() THEN
    RETURN NEW;
  END IF;

  IF current_setting('carehub.system_status_write', true) = 'on' THEN
    RETURN NEW;
  END IF;

  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  v_caller_user_id   := public.get_user_id_from_jwt_sub();
  v_caller_doctor_id := public.get_doctor_profile_id();
  v_is_patient       := OLD.patient_id = v_caller_user_id;
  v_is_doctor        := OLD.doctor_id = v_caller_doctor_id;

  IF v_is_patient THEN
    IF (NEW.status = 'cancelled' AND OLD.status IN ('pending_payment', 'waiting_for_doctor', 'scheduled'))
       OR (NEW.status = 'missed' AND OLD.status IN ('accepted', 'waiting_for_doctor'))
       OR (NEW.status = 'call_declined' AND OLD.status = 'accepted')
       OR (NEW.status = 'in_progress' AND OLD.status IN ('accepted', 'active'))
       OR (NEW.status IN ('scheduled', 'waiting_for_doctor') AND OLD.status = 'pending_payment' AND NEW.payment_status = 'paid')
    THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'FORBIDDEN: Patients cannot change a consultation from % to %.', OLD.status, NEW.status;
  END IF;

  IF v_is_doctor THEN
    IF (NEW.status = 'accepted' AND OLD.status = 'waiting_for_doctor')
       OR (NEW.status = 'declined' AND OLD.status = 'waiting_for_doctor')
       OR (NEW.status = 'in_progress' AND OLD.status IN ('accepted', 'active'))
       OR (NEW.status = 'completed' AND OLD.status IN ('accepted', 'in_progress', 'active'))
    THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'FORBIDDEN: Doctors cannot change a consultation from % to %.', OLD.status, NEW.status;
  END IF;

  RAISE EXCEPTION 'FORBIDDEN: You do not have permission to change this consultation''s status.';
END;
$$;

-- ── H1: release an abandoned partial-credit reservation ──────────────────────
-- apply-credit's partial-coverage branch (edge function, fixed alongside
-- this migration) now claims credit_used=true atomically at reservation
-- time instead of only at webhook-confirmed payment, closing a
-- double-credit-consumption path (abandon-and-rebook before either pays).
-- Claiming that early means a patient who abandons the new booking before
-- completing its Chapa top-up would otherwise lose the credit permanently —
-- this extends the existing 30-minute stale-pending-payment sweep
-- (migration 061, unchanged cadence) to release the reservation first.
CREATE OR REPLACE FUNCTION public.cancel_stale_pending_payments()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE public.consultations credit_row
  SET credit_used = false,
      replacement_consultation_id = NULL
  FROM public.consultations stale
  WHERE credit_row.id = stale.credit_source_id
    AND credit_row.credit_used = true
    AND stale.status = 'pending_payment'
    AND stale.payment_status IS DISTINCT FROM 'paid'
    AND stale.created_at < NOW() - INTERVAL '30 minutes';

  UPDATE public.consultations
  SET status = 'cancelled', updated_at = NOW()
  WHERE status = 'pending_payment'
    AND created_at < NOW() - INTERVAL '30 minutes';
END;
$$;

-- ── H2: drop the wide-open slot_locks INSERT policy ──────────────────────────
-- Same reasoning migration 089 already applied to this table's UPDATE policy:
-- no client code anywhere calls .from('slot_locks').insert(...) directly —
-- every write goes through book_appointment_slot()/reschedule_appointment_slot()
-- (SECURITY DEFINER, bypasses RLS as the table owner). Nothing legitimate
-- depends on this policy; it only ever enabled free, indefinite
-- calendar-griefing of any doctor by any authenticated user.
DROP POLICY IF EXISTS "Authenticated users can acquire slot locks" ON public.slot_locks;

-- ── H5: grid-alignment + fixed-duration enforcement ──────────────────────────
-- Same body as migration 054 (current, unchanged since — CREATE OR REPLACE in
-- place); adds two checks the shipped UI already always satisfies (slots are
-- generated in fixed 20-minute increments off the doctor's configured start
-- time — see lib/slotGeneration.ts's SLOT_DURATION_MINS), closing the gap for
-- a direct RPC call with a hand-crafted off-grid start time or non-standard
-- duration.
CREATE OR REPLACE FUNCTION public._validate_scheduled_slot(
  p_avail         jsonb,
  p_slot_start    timestamptz,
  p_slot_duration int
)
RETURNS void
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_local_ts        timestamptz;
  v_day_key         text;
  v_day_cfg         jsonb;
  v_blocked         jsonb;
  v_date_str        text;
  v_start_mins      int;
  v_end_mins        int;
  v_slot_start_mins int;
BEGIN
  IF p_slot_duration IS DISTINCT FROM 20 THEN
    RAISE EXCEPTION 'INVALID_DURATION: Consultations must be booked in fixed 20-minute slots.';
  END IF;

  -- Normalize to local wall-clock time before deriving day-of-week, date,
  -- or minutes-since-midnight — doctor_profiles.availability and every
  -- client's slot generation are both local-time-implicit with no offset
  -- marker, so the server must localize too or its checks drift from what
  -- the client actually offered.
  v_local_ts := p_slot_start AT TIME ZONE 'Africa/Addis_Ababa';

  IF EXTRACT(SECOND FROM v_local_ts) <> 0 THEN
    RAISE EXCEPTION 'INVALID_SLOT: This time is not a valid appointment slot.';
  END IF;
  v_slot_start_mins := EXTRACT(HOUR FROM v_local_ts)::int * 60 + EXTRACT(MINUTE FROM v_local_ts)::int;

  v_day_key := CASE EXTRACT(DOW FROM v_local_ts)
    WHEN 0 THEN 'Sun' WHEN 1 THEN 'Mon' WHEN 2 THEN 'Tue' WHEN 3 THEN 'Wed'
    WHEN 4 THEN 'Thu' WHEN 5 THEN 'Fri' WHEN 6 THEN 'Sat'
  END;
  v_day_cfg := p_avail -> v_day_key;
  IF v_day_cfg IS NULL OR COALESCE((v_day_cfg->>'enabled')::boolean, false) = false THEN
    RAISE EXCEPTION 'DAY_OFF: This doctor is not available on %.', v_day_key;
  END IF;

  v_blocked := COALESCE(p_avail->'blocked_dates', '[]'::jsonb);
  v_date_str := to_char(v_local_ts, 'YYYY-MM-DD');
  IF v_blocked ? v_date_str THEN
    RAISE EXCEPTION 'DATE_BLOCKED: This doctor is unavailable on the selected date.';
  END IF;

  v_start_mins := _parse_time_to_minutes(v_day_cfg->>'startTime');
  v_end_mins   := _parse_time_to_minutes(v_day_cfg->>'endTime');
  IF v_start_mins IS NOT NULL AND v_end_mins IS NOT NULL THEN
    IF v_slot_start_mins < v_start_mins OR v_slot_start_mins + p_slot_duration > v_end_mins THEN
      RAISE EXCEPTION 'OUTSIDE_HOURS: This time is outside the doctor''s working hours (% - %).',
        v_day_cfg->>'startTime', v_day_cfg->>'endTime';
    END IF;
    -- Grid is anchored to the doctor's own configured start time (matches
    -- lib/slotGeneration.ts, which walks forward from startTime in fixed
    -- 20-minute steps) — not to midnight, since startTime is not guaranteed
    -- to itself be a multiple of 20.
    IF (v_slot_start_mins - v_start_mins) % 20 <> 0 THEN
      RAISE EXCEPTION 'INVALID_SLOT: This time does not align with the doctor''s available slot grid.';
    END IF;
  ELSE
    -- Working hours failed to parse (malformed availability data) — no
    -- doctor-anchored grid is derivable, so fall back to a plain
    -- midnight-anchored 20-minute grid rather than skipping alignment
    -- enforcement entirely.
    IF v_slot_start_mins % 20 <> 0 THEN
      RAISE EXCEPTION 'INVALID_SLOT: This time is not a valid 20-minute appointment slot.';
    END IF;
  END IF;
END;
$$;

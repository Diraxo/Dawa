-- Migration: credit_on_doctor_missed_and_accept_busy_and_stale_sweep
--
-- Three independently-confirmed gaps from a full consultation-lifecycle audit:
--
-- 1. Both waiting-room screens (mobile + web) unconditionally tell the patient
--    "your credit has been preserved" when a consultation transitions to
--    'doctor_missed' (doctor never responded to a paid request). But
--    set_consultation_credit_on_decline() (migration 040) only fires on
--    'declined' or a pre-accept 'cancelled' — never on 'doctor_missed', which
--    is written in bulk by mark_doctor_missed_consultations() (migration 024).
--    The patient is told they have a credit that was never recorded.
--
-- 2. enforce_doctor_approved_for_accept() (migration 056) only checks
--    doctor_profiles.status = 'approved' before allowing a transition to
--    accepted/active — it never checks whether the doctor already has a
--    DIFFERENT accepted/in_progress consultation. book_appointment_slot()
--    blocks *creating* a second on-demand request against a busy doctor, but
--    if two waiting_for_doctor rows exist concurrently for the same doctor
--    (race, or one created before the other was accepted), nothing stops the
--    doctor from accepting both and being double-booked.
--
-- 3. book_appointment_slot()'s on-demand busy check excludes 'pending_payment',
--    and cleanup of an abandoned pre-payment row relies entirely on the
--    client (BookingModal's catch-and-cancel, or the poll-and-cancel in
--    payment-return.tsx). If the app/browser is killed before either runs,
--    the row is never cancelled. No pg_cron job sweeps stale pending_payment
--    rows.

-- ── 1. Credit issuance also covers doctor_missed ────────────────────────────
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
       OR NEW.status = 'doctor_missed'
       OR (NEW.status = 'cancelled' AND OLD.status IN ('pending_payment', 'waiting_for_doctor'))
     )
  THEN
    NEW.consultation_credit := true;
    NEW.credit_amount := COALESCE(NEW.patient_amount, OLD.patient_amount, 0);
  END IF;
  RETURN NEW;
END;
$function$;

-- ── 2. Block accepting a second consultation while already busy ────────────
CREATE OR REPLACE FUNCTION public.enforce_doctor_approved_for_accept()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_doctor_status text;
  v_already_busy  boolean;
BEGIN
  IF NEW.status IN ('accepted', 'active') AND OLD.status IS DISTINCT FROM NEW.status THEN
    SELECT status INTO v_doctor_status FROM public.doctor_profiles WHERE id = NEW.doctor_id;
    IF v_doctor_status IS DISTINCT FROM 'approved' THEN
      RAISE EXCEPTION 'DOCTOR_NOT_APPROVED: This doctor is not currently approved to accept consultations.';
    END IF;

    SELECT EXISTS (
      SELECT 1 FROM public.consultations
      WHERE doctor_id = NEW.doctor_id
        AND id <> NEW.id
        AND status IN ('accepted', 'in_progress')
    ) INTO v_already_busy;

    IF v_already_busy THEN
      RAISE EXCEPTION 'DOCTOR_BUSY: You are already in another consultation.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- ── 3. Sweep stale pre-payment consultations ────────────────────────────────
CREATE OR REPLACE FUNCTION public.cancel_stale_pending_payments()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE public.consultations
  SET status = 'cancelled', updated_at = NOW()
  WHERE status = 'pending_payment'
    AND created_at < NOW() - INTERVAL '30 minutes';
END;
$$;

SELECT cron.schedule(
  'cancel-stale-pending-payments',
  '*/10 * * * *',
  'SELECT public.cancel_stale_pending_payments()'
);

-- Migration: consultation_credit
-- When a doctor declines a paid consultation, the patient receives a
-- consultation credit equal to the amount they paid. This replaces the
-- previous refund flow. Credits can be applied to future bookings with
-- any doctor; the system charges only the difference when the new fee is higher.
--
-- New columns on consultations:
--   consultation_credit  BOOLEAN  — true when a credit was issued on this row
--   credit_amount        NUMERIC  — ETB value of the credit (= patient_amount at decline time)
--   credit_used          BOOLEAN  — true once this credit has been applied to a new booking
--   credit_source_id     UUID     — FK to the consultation whose credit funded this booking

ALTER TABLE public.consultations
  ADD COLUMN IF NOT EXISTS consultation_credit BOOLEAN  NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS credit_amount       NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS credit_used         BOOLEAN  NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS credit_source_id    UUID     REFERENCES public.consultations(id);

-- ── BEFORE UPDATE trigger ────────────────────────────────────────────────────
-- When a doctor declines a consultation that was already paid, automatically
-- stamp consultation_credit = true and credit_amount = patient_amount so that
-- the edge-function notification (and clients) see the credit immediately.
CREATE OR REPLACE FUNCTION set_consultation_credit_on_decline()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NEW.status = 'declined'
     AND OLD.status IS DISTINCT FROM NEW.status
     AND COALESCE(NEW.payment_status, OLD.payment_status) = 'paid'
     AND NOT COALESCE(NEW.consultation_credit, false)
  THEN
    NEW.consultation_credit := true;
    NEW.credit_amount := COALESCE(NEW.patient_amount, OLD.patient_amount, 0);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_credit_on_decline ON public.consultations;
CREATE TRIGGER trg_set_credit_on_decline
  BEFORE UPDATE OF status ON public.consultations
  FOR EACH ROW EXECUTE FUNCTION set_consultation_credit_on_decline();

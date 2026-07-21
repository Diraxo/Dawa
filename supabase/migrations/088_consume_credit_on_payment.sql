-- Migration: consume_credit_on_payment
--
-- Root cause of the "consultation credit never consumed" billing bug:
-- credit_used was only ever flipped to true by application code, in two
-- separate places —
--   1. apply-credit/index.ts (full-coverage branch): sets credit_used=true
--      immediately, since no Chapa payment is needed at all.
--   2. chapa-webhook/index.ts (partial-coverage branch): sets
--      credit_used=true only once Chapa confirms the difference payment.
-- Both are correct for the paths that call them. But #2 is the ONLY place
-- that ever consumes a partial credit, and it only runs when chapa-webhook
-- itself is invoked. Any other code path that marks a consultation
-- payment_status='paid' while carrying a credit_source_id — e.g. the mobile
-- __DEV__ payment-bypass in components/ui/BookingModal.tsx, which
-- deliberately mimics chapa-webhook's payment_status flip without going
-- through Chapa (and therefore never calls chapa-webhook) — silently skips
-- credit consumption. The credit then stays credit_used=false forever and
-- keeps reappearing on every future booking.
--
-- Confirmed live: consultation 71254c9a-9f07-415f-a401-92074d9f508a
-- (a chat credit worth ETB 100) was reapplied via credit_source_id to 7
-- different completed ETB 300 chat consultations, none of which had a
-- chapa_tx_ref (the dev-bypass signature) — credit_used never flipped.
--
-- Fix: make credit consumption a DB-level side effect of the payment_status
-- transition itself, atomic and unconditional regardless of which code path
-- performs the write. This does not replace the existing edge-function
-- writes (harmless — both are idempotent, guarded on credit_used=false) but
-- makes them redundant rather than load-bearing, closing the gap for good.

CREATE OR REPLACE FUNCTION public.consume_credit_on_payment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NEW.payment_status = 'paid'
     AND OLD.payment_status IS DISTINCT FROM NEW.payment_status
     AND NEW.credit_source_id IS NOT NULL
  THEN
    UPDATE public.consultations
    SET credit_used = true
    WHERE id = NEW.credit_source_id
      AND credit_used = false;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_consume_credit_on_payment ON public.consultations;
CREATE TRIGGER trg_consume_credit_on_payment
  AFTER UPDATE OF payment_status ON public.consultations
  FOR EACH ROW EXECUTE FUNCTION public.consume_credit_on_payment();

-- ── Backfill the one currently-stuck credit ─────────────────────────────────
-- 71254c9a-9f07-415f-a401-92074d9f508a was already legitimately spent (its
-- replacement consultation is paid + completed) but never marked used because
-- it predates this trigger and went through the dev-bypass path. Correct it
-- directly rather than leaving it exploitable until the next booking cycle.
UPDATE public.consultations
SET credit_used = true
WHERE id = '71254c9a-9f07-415f-a401-92074d9f508a'
  AND credit_used = false
  AND replacement_consultation_id IS NOT NULL;

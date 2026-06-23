-- Migration: chapa_refund
-- Adds Chapa payment tracking columns to consultations and a trigger that
-- automatically calls the handle-refund Edge Function when a paid
-- consultation is cancelled (doctor declined or 30-second timeout).

-- ── New columns ───────────────────────────────────────────────────────────────

-- chapa_tx_ref: the transaction reference returned by Chapa at payment time.
--   Saved by the app immediately after a successful Chapa payment.
--   Required to call the Chapa Refund API.
ALTER TABLE public.consultations
  ADD COLUMN IF NOT EXISTS chapa_tx_ref   TEXT,
  ADD COLUMN IF NOT EXISTS refund_status  TEXT NOT NULL DEFAULT 'none';

-- refund_status values:
--   'none'       → no refund needed / not yet triggered
--   'processing' → Chapa refund API called successfully
--   'refunded'   → confirmed refunded (manual update or webhook)
--   'failed'     → Chapa API call failed; requires manual support action

-- ── Trigger function ──────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION on_consultation_cancelled_refund()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  service_key TEXT;
BEGIN
  -- Only act when:
  --   1. status changes TO 'cancelled'
  --   2. patient already paid (payment_status = 'paid')
  --   3. we have a Chapa tx_ref to refund
  --   4. not already refunded or processing
  IF OLD.status IS DISTINCT FROM NEW.status
     AND NEW.status        = 'cancelled'
     AND NEW.payment_status = 'paid'
     AND NEW.chapa_tx_ref  IS NOT NULL
     AND NEW.refund_status  = 'none'
  THEN
    SELECT decrypted_secret INTO service_key
    FROM vault.decrypted_secrets
    WHERE name = 'carehub_service_role_key'
    LIMIT 1;

    IF service_key IS NOT NULL AND service_key <> '' THEN
      PERFORM net.http_post(
        url     := 'https://ulrgkqjjiclulnuotifh.supabase.co/functions/v1/handle-refund',
        headers := jsonb_build_object(
          'Content-Type',  'application/json',
          'Authorization', 'Bearer ' || service_key
        ),
        body    := jsonb_build_object(
          'consultation_id', NEW.id::text,
          'tx_ref',          NEW.chapa_tx_ref
        ),
        timeout_milliseconds := 15000
      );
    ELSE
      RAISE WARNING '[CareHub] vault secret carehub_service_role_key not set — refund skipped for consultation %', NEW.id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_consultation_refund ON public.consultations;
CREATE TRIGGER trg_consultation_refund
  AFTER UPDATE OF status ON public.consultations
  FOR EACH ROW EXECUTE FUNCTION on_consultation_cancelled_refund();

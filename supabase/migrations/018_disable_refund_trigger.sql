-- Migration: disable_refund_trigger
-- Disables automatic refund processing for V1.
-- Refunds are handled manually; the infrastructure is kept for a future release.

-- Drop the live trigger so it never fires again
DROP TRIGGER IF EXISTS trg_consultation_refund ON public.consultations;

-- Replace the function body with a no-op so any stale calls are harmless
CREATE OR REPLACE FUNCTION on_consultation_cancelled_refund()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Refunds are disabled in V1. No automatic refund processing.
  RETURN NEW;
END;
$$;

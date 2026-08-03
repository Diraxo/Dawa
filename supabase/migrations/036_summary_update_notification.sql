-- Migration: summary_update_notification
-- Adds an `updated_at` column to consultation_summaries and extends the
-- existing notification trigger to also fire when a doctor edits an
-- already-submitted summary (previously only fired on INSERT), so the
-- patient is notified and always knows the record they're viewing may have
-- changed. Only fires for edits to actual clinical content — not for the
-- best-effort report_pdf_path backfill written after PDF generation.

ALTER TABLE public.consultation_summaries
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE OR REPLACE FUNCTION set_summary_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_summary_set_updated_at ON consultation_summaries;
CREATE TRIGGER trg_summary_set_updated_at
  BEFORE UPDATE ON consultation_summaries
  FOR EACH ROW EXECUTE FUNCTION set_summary_updated_at();

CREATE OR REPLACE FUNCTION on_summary_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM _call_consultation_notification('summary_ready', NEW.consultation_id);

  ELSIF TG_OP = 'UPDATE' AND (
    OLD.chief_complaint IS DISTINCT FROM NEW.chief_complaint OR
    OLD.diagnosis IS DISTINCT FROM NEW.diagnosis OR
    OLD.prescription IS DISTINCT FROM NEW.prescription OR
    OLD.followup_recommendation IS DISTINCT FROM NEW.followup_recommendation OR
    OLD.referral_needed IS DISTINCT FROM NEW.referral_needed OR
    OLD.referral_specialty IS DISTINCT FROM NEW.referral_specialty
  ) THEN
    PERFORM _call_consultation_notification('summary_updated', NEW.consultation_id);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_summary_notification ON consultation_summaries;
CREATE TRIGGER trg_summary_notification
  AFTER INSERT OR UPDATE ON consultation_summaries
  FOR EACH ROW EXECUTE FUNCTION on_summary_change();

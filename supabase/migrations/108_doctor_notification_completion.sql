-- Migration 108: Doctor Notification System — Final Completion
--
-- Closes the remaining gaps identified by the doctor-side notification
-- follow-up spec (mirrors the patient-side migration 107):
--
-- 1. Admin was never notified when a doctor submits a document re-upload
--    (doctor_profiles.document_review_status -> 'pending', migration 077) —
--    admins only found out by noticing the Doctors page happened to
--    re-render via its own Realtime subscription. Adds a trigger that calls
--    the new notify-document-update-request edge function (in-app row + web
--    push to every admin), exactly the same DB-trigger-only, shared-secret
--    pattern already used by _call_consultation_notification (migration 085).
--
-- Everything else in the spec (withdrawal push, notification-tap deep
-- links, Notification Center icons, the earnings preference actually being
-- read) is client/API-route-side only — no schema change needed, since it
-- reuses the existing `notifications.data_json` and
-- `notification_preferences.earnings` columns (migration 053).

CREATE OR REPLACE FUNCTION public.notify_admins_of_document_update_request()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  service_key TEXT;
BEGIN
  IF NEW.document_review_status IS DISTINCT FROM OLD.document_review_status
     AND NEW.document_review_status = 'pending' THEN

    SELECT decrypted_secret INTO service_key
    FROM vault.decrypted_secrets
    WHERE name = 'internal_notification_secret'
    LIMIT 1;

    IF service_key IS NULL OR service_key = '' THEN
      RAISE WARNING '[Dawa] vault secret internal_notification_secret not set — skipping admin document-update notification';
      RETURN NEW;
    END IF;

    PERFORM net.http_post(
      url     := 'https://ulrgkqjjiclulnuotifh.supabase.co/functions/v1/notify-document-update-request',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || service_key
      ),
      body    := jsonb_build_object('doctor_profile_id', NEW.id::text),
      timeout_milliseconds := 10000
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_document_update_request ON public.doctor_profiles;
CREATE TRIGGER trg_notify_document_update_request
  AFTER UPDATE OF document_review_status ON public.doctor_profiles
  FOR EACH ROW EXECUTE FUNCTION public.notify_admins_of_document_update_request();

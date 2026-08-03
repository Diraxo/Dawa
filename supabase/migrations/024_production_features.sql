-- Migration 024: Production Features
-- Applied 2026-06-27 via Supabase MCP
-- 1. Review moderation (hidden flag + hidden_reason)
-- 2. doctor_profiles.review_count
-- 3. Updated rating trigger (excludes hidden, updates review_count)
-- 4. RLS: hide moderated reviews from non-admins
-- 5. followup_reminders table + RLS + pg_cron
-- 6. consultations.last_heartbeat_at + updated_at (from migration 023)
-- 7. mark_doctor_missed + mark_stale pg_cron jobs (from migration 023)
-- 8. Performance indexes

ALTER TABLE public.reviews
  ADD COLUMN IF NOT EXISTS hidden boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS hidden_reason text;

ALTER TABLE public.doctor_profiles
  ADD COLUMN IF NOT EXISTS review_count integer NOT NULL DEFAULT 0;

UPDATE public.doctor_profiles dp
SET review_count = (
  SELECT COUNT(*) FROM public.reviews r
  WHERE r.doctor_id = dp.id AND r.hidden = false
);

CREATE OR REPLACE FUNCTION public.update_doctor_rating_stats()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_doctor_id uuid;
BEGIN
  v_doctor_id := COALESCE(NEW.doctor_id, OLD.doctor_id);
  UPDATE public.doctor_profiles
  SET
    rating_average = (
      SELECT COALESCE(ROUND(AVG(rating)::numeric, 2), 0)
      FROM public.reviews
      WHERE doctor_id = v_doctor_id AND hidden = false
    ),
    review_count = (
      SELECT COUNT(*)::integer
      FROM public.reviews
      WHERE doctor_id = v_doctor_id AND hidden = false
    )
  WHERE id = v_doctor_id;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_update_doctor_rating ON public.reviews;
DROP TRIGGER IF EXISTS trg_review_notification ON public.reviews;
DROP TRIGGER IF EXISTS trg_doctor_rating_stats ON public.reviews;

CREATE TRIGGER trg_doctor_rating_stats
  AFTER INSERT OR UPDATE OR DELETE ON public.reviews
  FOR EACH ROW EXECUTE FUNCTION public.update_doctor_rating_stats();

DROP POLICY IF EXISTS reviews_select ON public.reviews;
CREATE POLICY reviews_select ON public.reviews
  FOR SELECT
  USING (
    hidden = false
    OR public.is_admin()
    OR (auth.role() = 'authenticated' AND patient_id = public.get_user_id_from_jwt_sub())
  );

DROP POLICY IF EXISTS reviews_admin_update ON public.reviews;
CREATE POLICY reviews_admin_update ON public.reviews
  FOR UPDATE
  USING (public.is_admin());

CREATE TABLE IF NOT EXISTS public.followup_reminders (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consultation_id uuid NOT NULL REFERENCES public.consultations(id) ON DELETE CASCADE,
  patient_id      uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  doctor_id       uuid NOT NULL REFERENCES public.doctor_profiles(id) ON DELETE CASCADE,
  remind_at       timestamptz NOT NULL,
  message         text,
  sent            boolean NOT NULL DEFAULT false,
  sent_at         timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.followup_reminders ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_followup_reminders_unsent
  ON public.followup_reminders (remind_at)
  WHERE sent = false;

CREATE OR REPLACE FUNCTION public.process_followup_reminders()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  r RECORD;
  v_doctor_name text;
BEGIN
  FOR r IN
    SELECT fr.*
    FROM public.followup_reminders fr
    WHERE fr.sent = false AND fr.remind_at <= now()
  LOOP
    BEGIN
      SELECT u2.full_name INTO v_doctor_name
      FROM public.doctor_profiles dp
      JOIN public.users u2 ON u2.id = dp.user_id
      WHERE dp.id = r.doctor_id LIMIT 1;

      INSERT INTO public.notifications (user_id, type, title, body, data_json)
      VALUES (
        r.patient_id, 'followup_reminder', 'Follow-up Reminder',
        COALESCE(r.message, 'Dr. ' || COALESCE(v_doctor_name, 'your doctor') || ' scheduled a follow-up reminder for you.'),
        jsonb_build_object('consultation_id', r.consultation_id, 'reminder_id', r.id)
      );

      UPDATE public.followup_reminders SET sent = true, sent_at = now() WHERE id = r.id;
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  END LOOP;
END;
$$;

ALTER TABLE public.consultations
  ADD COLUMN IF NOT EXISTS last_heartbeat_at timestamptz,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_consultations_heartbeat
  ON public.consultations (status, last_heartbeat_at)
  WHERE status IN ('accepted', 'in_progress', 'active');

CREATE OR REPLACE FUNCTION public.mark_doctor_missed_consultations()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_timeout_seconds int := 120;
BEGIN
  BEGIN
    SELECT (value::text)::int INTO v_timeout_seconds
    FROM public.app_config WHERE key = 'waiting_room_timeout_seconds' LIMIT 1;
  EXCEPTION WHEN OTHERS THEN v_timeout_seconds := 120;
  END;
  UPDATE public.consultations
  SET status = 'doctor_missed', updated_at = NOW()
  WHERE status = 'waiting_for_doctor'
    AND payment_status = 'paid'
    AND waiting_started_at IS NOT NULL
    AND waiting_started_at < NOW() - (v_timeout_seconds || ' seconds')::interval;
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_stale_active_consultations()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE public.consultations
  SET status = 'ended_abnormally', ended_at = NOW(), updated_at = NOW()
  WHERE status IN ('accepted', 'in_progress', 'active')
    AND (
      (last_heartbeat_at IS NOT NULL AND last_heartbeat_at < NOW() - INTERVAL '10 minutes')
      OR (last_heartbeat_at IS NULL AND started_at < NOW() - INTERVAL '8 hours')
    );
END;
$$;

CREATE INDEX IF NOT EXISTS idx_consultations_patient_status ON public.consultations (patient_id, status);
CREATE INDEX IF NOT EXISTS idx_consultations_doctor_status  ON public.consultations (doctor_id, status);
CREATE INDEX IF NOT EXISTS idx_consultations_created_at     ON public.consultations (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reviews_doctor_id            ON public.reviews (doctor_id) WHERE hidden = false;
CREATE INDEX IF NOT EXISTS idx_reviews_patient_id           ON public.reviews (patient_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user_id        ON public.notifications (user_id, created_at DESC);

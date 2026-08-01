-- Migration 110: Notification reliability + replay protection (Phase-5 audit H1, M3, M4)
--
-- Three related fixes, all modeled directly on migration 103's
-- retry_unfrozen_chat_channels() pattern (write-back confirmation + timed
-- retry sweep), applied to the notification pipeline:
--
-- (1) H1a — migration 105 flips notification_sent/reminder_*_sent TRUE in
--     the same atomic UPDATE that claims a row, *before* net.http_post ever
--     fires. If that HTTP call fails to enqueue, or the edge function
--     errors, the row is already permanently marked sent with no retry.
--     Fix: the *_sent columns keep meaning "claimed" (still prevents
--     duplicate claims); new *_confirmed_at columns mean "the edge function
--     actually ran this to completion," written by the edge function itself
--     on success. A new sweep retries any claim that's gone stale without
--     confirming.
--
-- (2) H1b — 3 of the 5 cron-driven notification paths (process_followup_
--     reminders, trigger_doctor_repeat_notifications, mark_running_late_
--     consultations) never got migration 105's atomic-claim treatment and
--     still have a select-then-dispatch-then-flag-later TOCTOU window. Fixed
--     here for all three, using the same UPDATE...RETURNING claim shape.
--
-- (3) M3 — every event-driven consultation notification (accepted, declined,
--     cancelled, completed, summary_ready, patient_joined, doctor_delayed,
--     etc. — everything that flows through _call_consultation_notification)
--     is a one-shot fire-and-forget call with no retry at all. Adds a
--     generic dispatch log + confirm-on-success + retry sweep that covers
--     every event through that single choke point, with an ordering guard
--     so a late retry of a stale event can never land after a newer event
--     for the same consultation has already been confirmed delivered.
--
-- (4) M4 — replay protection. Every net.http_post call site below adds an
--     X-Notification-Nonce (fresh gen_random_uuid() per HTTP attempt) and
--     X-Notification-Timestamp header alongside the existing Authorization
--     bearer. The edge functions (separate change, same deploy) reject a
--     request whose timestamp is stale/missing or whose nonce has already
--     been seen. The nonce is per-*attempt*, not per-event — a legitimate
--     retry of the same logical event gets its own fresh nonce; only literal
--     replay of one exact HTTP request is rejected.
--
-- Everything here is additive: no existing *_sent flag, cron schedule, or
-- notification copy/behavior changes. Retries can only cause an extra
-- (client-deduplicated, via the existing Expo tag/collapseId) push, never a
-- lost one that used to arrive, and the ordering guard prevents a stale
-- retry from overwriting a newer, already-delivered status update.

-- ── 1. Confirmation + claim-timestamp columns for scheduled notifications ──
ALTER TABLE public.consultations
  ADD COLUMN IF NOT EXISTS notification_claimed_at   timestamptz,
  ADD COLUMN IF NOT EXISTS notification_confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS reminder_30_claimed_at     timestamptz,
  ADD COLUMN IF NOT EXISTS reminder_30_confirmed_at   timestamptz,
  ADD COLUMN IF NOT EXISTS reminder_10_claimed_at     timestamptz,
  ADD COLUMN IF NOT EXISTS reminder_10_confirmed_at   timestamptz,
  ADD COLUMN IF NOT EXISTS reminder_5_claimed_at      timestamptz,
  ADD COLUMN IF NOT EXISTS reminder_5_confirmed_at    timestamptz;

ALTER TABLE public.followup_reminders
  ADD COLUMN IF NOT EXISTS claimed_at timestamptz;

-- ── 2. Generic dispatch log for every _call_consultation_notification event ─
CREATE TABLE IF NOT EXISTS public.notification_dispatch_log (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consultation_id uuid NOT NULL,
  event           text NOT NULL,
  dedupe_key      text NOT NULL UNIQUE,
  payload         jsonb NOT NULL,
  requested_at    timestamptz NOT NULL DEFAULT now(),
  confirmed_at    timestamptz,
  attempts        int NOT NULL DEFAULT 0,
  last_attempt_at timestamptz,
  last_error      text
);

CREATE INDEX IF NOT EXISTS idx_notification_dispatch_log_unconfirmed
  ON public.notification_dispatch_log (consultation_id, requested_at)
  WHERE confirmed_at IS NULL;

ALTER TABLE public.notification_dispatch_log ENABLE ROW LEVEL SECURITY;
-- No client-facing policies — service role (edge functions, cron) only.

-- ── 3. Replay-protection nonce store ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.notification_request_nonces (
  nonce   uuid PRIMARY KEY,
  seen_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.notification_request_nonces ENABLE ROW LEVEL SECURITY;
-- No client-facing policies — service role only.

-- ── 4. _call_consultation_notification: log + nonce/timestamp headers ──────
-- Single choke point for every event-driven consultation notification
-- (on_consultation_change, the presence trigger, mark_running_late_
-- consultations, trigger_doctor_repeat_notifications, process_rating_
-- reminders). Logging and nonce/timestamp emission here covers all of them
-- at once. A same-key re-fire (should only really happen for new_request's
-- existing 3-minute repeat, which gets its own per-minute-bucketed key
-- below) resets confirmation state rather than being silently swallowed.
CREATE OR REPLACE FUNCTION public._call_consultation_notification(p_event text, p_consultation_id uuid, p_extra jsonb DEFAULT '{}'::jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  service_key  TEXT;
  v_dedupe_key TEXT;
  v_log_id     uuid;
  v_payload    jsonb;
BEGIN
  SELECT decrypted_secret INTO service_key
  FROM vault.decrypted_secrets
  WHERE name = 'internal_notification_secret'
  LIMIT 1;

  IF service_key IS NULL OR service_key = '' THEN
    RAISE WARNING '[CareHub] vault secret internal_notification_secret not set — skipping notification';
    RETURN;
  END IF;

  v_payload := jsonb_build_object('event', p_event, 'consultation_id', p_consultation_id::text) || p_extra;

  v_dedupe_key := p_consultation_id::text || ':' || p_event
    || CASE WHEN (p_extra->>'repeat')::boolean IS TRUE
            THEN ':repeat:' || to_char(now(), 'YYYYMMDDHH24MI')
            ELSE '' END;

  INSERT INTO public.notification_dispatch_log (consultation_id, event, dedupe_key, payload)
  VALUES (p_consultation_id, p_event, v_dedupe_key, v_payload)
  ON CONFLICT (dedupe_key) DO UPDATE SET
    payload         = EXCLUDED.payload,
    requested_at    = now(),
    confirmed_at    = NULL,
    attempts        = 0,
    last_attempt_at = NULL,
    last_error      = NULL
  RETURNING id INTO v_log_id;

  PERFORM net.http_post(
    url     := 'https://ulrgkqjjiclulnuotifh.supabase.co/functions/v1/handle-consultation-notification',
    headers := jsonb_build_object(
      'Content-Type',              'application/json',
      'Authorization',             'Bearer ' || service_key,
      'X-Notification-Nonce',      gen_random_uuid()::text,
      'X-Notification-Timestamp',  now()::text
    ),
    body    := v_payload || jsonb_build_object('dispatch_log_id', v_log_id::text),
    timeout_milliseconds := 10000
  );
END;
$function$;

-- ── 5. retry_unconfirmed_consultation_notifications() ───────────────────────
-- Ordering guard: never retries a row if a *later* dispatch for the same
-- consultation has already confirmed — prevents a stale retried status
-- update from landing after a newer one the user already saw.
CREATE OR REPLACE FUNCTION public.retry_unconfirmed_consultation_notifications()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  rec RECORD;
  service_key TEXT;
  retried_count INT := 0;
BEGIN
  SELECT decrypted_secret INTO service_key
  FROM vault.decrypted_secrets
  WHERE name = 'internal_notification_secret'
  LIMIT 1;

  IF service_key IS NULL OR service_key = '' THEN
    RAISE WARNING '[Dawa] vault secret internal_notification_secret not set — skipping consultation-notification retry sweep';
    RETURN;
  END IF;

  FOR rec IN
    UPDATE public.notification_dispatch_log d
    SET attempts = d.attempts + 1,
        last_attempt_at = now()
    WHERE d.confirmed_at IS NULL
      AND d.requested_at < now() - interval '2 minutes'
      AND d.requested_at > now() - interval '2 hours'
      AND d.attempts < 5
      AND NOT EXISTS (
        SELECT 1 FROM public.notification_dispatch_log later
        WHERE later.consultation_id = d.consultation_id
          AND later.requested_at > d.requested_at
          AND later.confirmed_at IS NOT NULL
      )
    RETURNING d.id, d.payload
  LOOP
    retried_count := retried_count + 1;
    PERFORM net.http_post(
      url     := 'https://ulrgkqjjiclulnuotifh.supabase.co/functions/v1/handle-consultation-notification',
      headers := jsonb_build_object(
        'Content-Type',              'application/json',
        'Authorization',             'Bearer ' || service_key,
        'X-Notification-Nonce',      gen_random_uuid()::text,
        'X-Notification-Timestamp',  now()::text
      ),
      body    := rec.payload || jsonb_build_object('dispatch_log_id', rec.id::text),
      timeout_milliseconds := 10000
    );
  END LOOP;

  -- Nonce-store cleanup shares this cadence — no need for a dedicated job.
  DELETE FROM public.notification_request_nonces WHERE seen_at < now() - interval '1 hour';

  IF retried_count > 0 THEN
    RAISE WARNING '[Dawa] retry_unconfirmed_consultation_notifications: retried % unconfirmed dispatch(es)', retried_count;
  END IF;
END;
$$;

SELECT cron.schedule(
  'retry-unconfirmed-consultation-notifications',
  '*/2 * * * *',
  'SELECT public.retry_unconfirmed_consultation_notifications();'
);

-- ── 6. trigger_appointment_notifications() / trigger_appointment_reminders() ─
-- Carried forward unchanged from migration 105 except: claim timestamp
-- written alongside the existing atomic *_sent claim, and nonce/timestamp
-- headers added to each net.http_post call.
CREATE OR REPLACE FUNCTION trigger_appointment_notifications()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  rec         RECORD;
  service_key TEXT;
BEGIN
  UPDATE consultations c
  SET status = 'waiting_for_doctor',
      waiting_started_at = c.scheduled_at
  WHERE c.status = 'scheduled'
    AND c.scheduled_at <= now()
    AND NOT EXISTS (
      SELECT 1 FROM consultations b
      WHERE b.doctor_id = c.doctor_id
        AND b.status IN ('waiting_for_doctor', 'accepted', 'in_progress')
    )
    AND NOT EXISTS (
      SELECT 1 FROM consultations e
      WHERE e.doctor_id = c.doctor_id
        AND e.id <> c.id
        AND e.status = 'scheduled'
        AND e.scheduled_at <= now()
        AND e.scheduled_at < c.scheduled_at
    )
    AND NOT EXISTS (
      SELECT 1 FROM consultations p
      WHERE p.patient_id = c.patient_id
        AND p.id <> c.id
        AND p.status IN ('waiting_for_doctor', 'accepted', 'in_progress')
    );

  SELECT decrypted_secret INTO service_key
  FROM vault.decrypted_secrets
  WHERE name = 'internal_notification_secret'
  LIMIT 1;

  IF service_key IS NULL OR service_key = '' THEN
    RAISE WARNING '[CareHub] vault secret internal_notification_secret not set — skipping';
    RETURN;
  END IF;

  FOR rec IN
    UPDATE consultations
    SET notification_sent = TRUE,
        notification_claimed_at = now()
    WHERE scheduled_at BETWEEN now() - INTERVAL '3 minutes'
                            AND now()
      AND status IN ('pending', 'waiting_for_doctor')
      AND notification_sent = FALSE
    RETURNING id
  LOOP
    PERFORM net.http_post(
      url     := 'https://ulrgkqjjiclulnuotifh.supabase.co/functions/v1/send-appointment-notification',
      headers := jsonb_build_object(
        'Content-Type',              'application/json',
        'Authorization',             'Bearer ' || service_key,
        'X-Notification-Nonce',      gen_random_uuid()::text,
        'X-Notification-Timestamp',  now()::text
      ),
      body    := jsonb_build_object('appointment_id', rec.id::text),
      timeout_milliseconds := 10000
    );
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION trigger_appointment_reminders()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  rec         RECORD;
  service_key TEXT;
BEGIN
  SELECT decrypted_secret INTO service_key
  FROM vault.decrypted_secrets
  WHERE name = 'internal_notification_secret'
  LIMIT 1;

  IF service_key IS NULL OR service_key = '' THEN
    RAISE WARNING '[CareHub] vault secret internal_notification_secret not set — skipping';
    RETURN;
  END IF;

  FOR rec IN
    UPDATE consultations
    SET reminder_30_sent = TRUE,
        reminder_30_claimed_at = now()
    WHERE scheduled_at BETWEEN now() + INTERVAL '27 minutes'
                            AND now() + INTERVAL '30 minutes'
      AND status IN ('pending', 'scheduled', 'waiting_for_doctor')
      AND reminder_30_sent = FALSE
    RETURNING id
  LOOP
    PERFORM net.http_post(
      url     := 'https://ulrgkqjjiclulnuotifh.supabase.co/functions/v1/send-appointment-notification',
      headers := jsonb_build_object(
        'Content-Type',              'application/json',
        'Authorization',             'Bearer ' || service_key,
        'X-Notification-Nonce',      gen_random_uuid()::text,
        'X-Notification-Timestamp',  now()::text
      ),
      body    := jsonb_build_object('appointment_id', rec.id::text, 'kind', 'reminder_30'),
      timeout_milliseconds := 10000
    );
  END LOOP;

  FOR rec IN
    UPDATE consultations
    SET reminder_10_sent = TRUE,
        reminder_10_claimed_at = now()
    WHERE scheduled_at BETWEEN now() + INTERVAL '7 minutes'
                            AND now() + INTERVAL '10 minutes'
      AND status IN ('pending', 'scheduled', 'waiting_for_doctor')
      AND reminder_10_sent = FALSE
    RETURNING id
  LOOP
    PERFORM net.http_post(
      url     := 'https://ulrgkqjjiclulnuotifh.supabase.co/functions/v1/send-appointment-notification',
      headers := jsonb_build_object(
        'Content-Type',              'application/json',
        'Authorization',             'Bearer ' || service_key,
        'X-Notification-Nonce',      gen_random_uuid()::text,
        'X-Notification-Timestamp',  now()::text
      ),
      body    := jsonb_build_object('appointment_id', rec.id::text, 'kind', 'reminder_10'),
      timeout_milliseconds := 10000
    );
  END LOOP;

  FOR rec IN
    UPDATE consultations
    SET reminder_5_sent = TRUE,
        reminder_5_claimed_at = now()
    WHERE scheduled_at BETWEEN now() + INTERVAL '2 minutes'
                            AND now() + INTERVAL '5 minutes'
      AND status IN ('pending', 'scheduled', 'waiting_for_doctor')
      AND reminder_5_sent = FALSE
      AND (scheduled_at - created_at) < INTERVAL '10 minutes'
    RETURNING id
  LOOP
    PERFORM net.http_post(
      url     := 'https://ulrgkqjjiclulnuotifh.supabase.co/functions/v1/send-appointment-notification',
      headers := jsonb_build_object(
        'Content-Type',              'application/json',
        'Authorization',             'Bearer ' || service_key,
        'X-Notification-Nonce',      gen_random_uuid()::text,
        'X-Notification-Timestamp',  now()::text
      ),
      body    := jsonb_build_object('appointment_id', rec.id::text, 'kind', 'reminder_5'),
      timeout_milliseconds := 10000
    );
  END LOOP;
END;
$$;

-- ── 7. retry_unconfirmed_appointment_notifications() ────────────────────────
CREATE OR REPLACE FUNCTION public.retry_unconfirmed_appointment_notifications()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  rec RECORD;
  service_key TEXT;
  retried_count INT := 0;
BEGIN
  SELECT decrypted_secret INTO service_key
  FROM vault.decrypted_secrets
  WHERE name = 'internal_notification_secret'
  LIMIT 1;

  IF service_key IS NULL OR service_key = '' THEN
    RAISE WARNING '[Dawa] vault secret internal_notification_secret not set — skipping appointment-notification retry sweep';
    RETURN;
  END IF;

  FOR rec IN
    SELECT id FROM public.consultations
    WHERE notification_sent = true
      AND notification_confirmed_at IS NULL
      AND notification_claimed_at < now() - interval '3 minutes'
      AND notification_claimed_at > now() - interval '2 hours'
    LIMIT 50
  LOOP
    retried_count := retried_count + 1;
    PERFORM net.http_post(
      url     := 'https://ulrgkqjjiclulnuotifh.supabase.co/functions/v1/send-appointment-notification',
      headers := jsonb_build_object(
        'Content-Type',              'application/json',
        'Authorization',             'Bearer ' || service_key,
        'X-Notification-Nonce',      gen_random_uuid()::text,
        'X-Notification-Timestamp',  now()::text
      ),
      body    := jsonb_build_object('appointment_id', rec.id::text),
      timeout_milliseconds := 10000
    );
  END LOOP;

  FOR rec IN
    SELECT id FROM public.consultations
    WHERE reminder_30_sent = true
      AND reminder_30_confirmed_at IS NULL
      AND reminder_30_claimed_at < now() - interval '3 minutes'
      AND reminder_30_claimed_at > now() - interval '2 hours'
    LIMIT 50
  LOOP
    retried_count := retried_count + 1;
    PERFORM net.http_post(
      url     := 'https://ulrgkqjjiclulnuotifh.supabase.co/functions/v1/send-appointment-notification',
      headers := jsonb_build_object(
        'Content-Type',              'application/json',
        'Authorization',             'Bearer ' || service_key,
        'X-Notification-Nonce',      gen_random_uuid()::text,
        'X-Notification-Timestamp',  now()::text
      ),
      body    := jsonb_build_object('appointment_id', rec.id::text, 'kind', 'reminder_30'),
      timeout_milliseconds := 10000
    );
  END LOOP;

  FOR rec IN
    SELECT id FROM public.consultations
    WHERE reminder_10_sent = true
      AND reminder_10_confirmed_at IS NULL
      AND reminder_10_claimed_at < now() - interval '3 minutes'
      AND reminder_10_claimed_at > now() - interval '2 hours'
    LIMIT 50
  LOOP
    retried_count := retried_count + 1;
    PERFORM net.http_post(
      url     := 'https://ulrgkqjjiclulnuotifh.supabase.co/functions/v1/send-appointment-notification',
      headers := jsonb_build_object(
        'Content-Type',              'application/json',
        'Authorization',             'Bearer ' || service_key,
        'X-Notification-Nonce',      gen_random_uuid()::text,
        'X-Notification-Timestamp',  now()::text
      ),
      body    := jsonb_build_object('appointment_id', rec.id::text, 'kind', 'reminder_10'),
      timeout_milliseconds := 10000
    );
  END LOOP;

  FOR rec IN
    SELECT id FROM public.consultations
    WHERE reminder_5_sent = true
      AND reminder_5_confirmed_at IS NULL
      AND reminder_5_claimed_at < now() - interval '3 minutes'
      AND reminder_5_claimed_at > now() - interval '2 hours'
    LIMIT 50
  LOOP
    retried_count := retried_count + 1;
    PERFORM net.http_post(
      url     := 'https://ulrgkqjjiclulnuotifh.supabase.co/functions/v1/send-appointment-notification',
      headers := jsonb_build_object(
        'Content-Type',              'application/json',
        'Authorization',             'Bearer ' || service_key,
        'X-Notification-Nonce',      gen_random_uuid()::text,
        'X-Notification-Timestamp',  now()::text
      ),
      body    := jsonb_build_object('appointment_id', rec.id::text, 'kind', 'reminder_5'),
      timeout_milliseconds := 10000
    );
  END LOOP;

  IF retried_count > 0 THEN
    RAISE WARNING '[Dawa] retry_unconfirmed_appointment_notifications: retried % unconfirmed send(s)', retried_count;
  END IF;
END;
$$;

SELECT cron.schedule(
  'retry-unconfirmed-appointment-notifications',
  '*/5 * * * *',
  'SELECT public.retry_unconfirmed_appointment_notifications();'
);

-- ── 8. process_followup_reminders(): atomic claim via claimed_at ───────────
-- `sent` remains the definitive "edge function completed this" flag (set by
-- send-appointment-notification itself, never pre-set here) — the only fix
-- needed is closing the TOCTOU window between SELECT and that later write,
-- which claimed_at-staleness does exactly like every other sweep here.
CREATE OR REPLACE FUNCTION public.process_followup_reminders()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  rec         RECORD;
  service_key TEXT;
BEGIN
  SELECT decrypted_secret INTO service_key
  FROM vault.decrypted_secrets
  WHERE name = 'internal_notification_secret'
  LIMIT 1;

  IF service_key IS NULL OR service_key = '' THEN
    RAISE WARNING '[CareHub] vault secret internal_notification_secret not set — skipping';
    RETURN;
  END IF;

  FOR rec IN
    UPDATE public.followup_reminders
    SET claimed_at = now()
    WHERE sent = false
      AND remind_at <= now()
      AND (claimed_at IS NULL OR claimed_at < now() - interval '3 minutes')
    RETURNING id
  LOOP
    PERFORM net.http_post(
      url     := 'https://ulrgkqjjiclulnuotifh.supabase.co/functions/v1/send-appointment-notification',
      headers := jsonb_build_object(
        'Content-Type',              'application/json',
        'Authorization',             'Bearer ' || service_key,
        'X-Notification-Nonce',      gen_random_uuid()::text,
        'X-Notification-Timestamp',  now()::text
      ),
      body    := jsonb_build_object('reminder_id', rec.id::text, 'kind', 'followup'),
      timeout_milliseconds := 10000
    );
  END LOOP;
END;
$function$;

-- ── 9. trigger_doctor_repeat_notifications(): atomic claim ─────────────────
-- Already routes through _call_consultation_notification (migration 084),
-- so it gets dispatch-log/nonce/replay coverage for free — only the
-- TOCTOU claim window needed closing.
CREATE OR REPLACE FUNCTION public.trigger_doctor_repeat_notifications()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  rec RECORD;
BEGIN
  FOR rec IN
    UPDATE public.consultations
    SET doctor_last_notified_at = now()
    WHERE status = 'waiting_for_doctor'
      AND COALESCE(doctor_last_notified_at, waiting_started_at) <= now() - interval '3 minutes'
    RETURNING id
  LOOP
    PERFORM public._call_consultation_notification('new_request', rec.id, jsonb_build_object('repeat', true));
  END LOOP;
END;
$$;

-- ── 10. mark_running_late_consultations(): atomic claim, both branches ─────
-- Also inherits the FIXUP from migration 107 (part (a) now routes through
-- _call_consultation_notification instead of a hand-rolled net.http_post
-- with the wrong vault secret) — carried forward here unchanged, just with
-- both loops converted to the same atomic UPDATE...RETURNING claim shape.
CREATE OR REPLACE FUNCTION public.mark_running_late_consultations()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  rec RECORD;
BEGIN
  FOR rec IN
    UPDATE public.consultations c
    SET running_late_notified = true
    WHERE c.status = 'scheduled'
      AND c.scheduled_at <= now()
      AND c.running_late_notified = false
      AND EXISTS (
        SELECT 1 FROM public.consultations b
        WHERE b.doctor_id = c.doctor_id
          AND b.id <> c.id
          AND b.status IN ('waiting_for_doctor', 'accepted', 'in_progress')
      )
    RETURNING c.id
  LOOP
    PERFORM public._call_consultation_notification('doctor_running_late', rec.id);
  END LOOP;

  FOR rec IN
    UPDATE public.consultations c
    SET running_late_notified = true
    WHERE c.status = 'waiting_for_doctor'
      AND c.is_on_demand IS NOT TRUE
      AND c.scheduled_at IS NOT NULL
      AND c.scheduled_at <= now()
      AND c.running_late_notified = false
      AND COALESCE(
        (SELECT dp.is_online FROM public.doctor_profiles dp WHERE dp.id = c.doctor_id),
        false
      ) = false
    RETURNING c.id
  LOOP
    PERFORM public._call_consultation_notification('doctor_delayed', rec.id);
  END LOOP;
END;
$$;

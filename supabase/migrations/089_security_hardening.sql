-- Migration 089: security hardening
--
-- Final pre-launch security audit found several direct-tampering gaps that
-- were never closed by the app's normal flows (which are all correct) but
-- were still reachable via a direct authenticated Supabase REST/RPC call
-- bypassing the app entirely. This migration closes them without changing
-- any behavior for legitimate callers — every fix below was checked against
-- every existing call site in app/, carehub-web/, and supabase/functions/.
--
--   a) consultations had no protection at all against a row-owner directly
--      PATCHing payment/credit columns (payment_status, patient_amount,
--      doctor_amount, platform_amount, credit_used, credit_source_id,
--      chapa_tx_ref, consultation_credit, credit_amount,
--      replacement_consultation_id) — consultations_update RLS (migration
--      002) has no WITH CHECK, same class of bug migrations 056/079 already
--      fixed for doctor_profiles/withdrawals but never applied here.
--      Migration 088's own comments document this is live-exploited via a
--      dev-only client bypass; a malicious client doesn't need that bypass
--      at all, since RLS alone already permits it.
--   b) book_appointment_slot() trusted the caller-supplied p_patient_amount
--      verbatim (only the commission split was computed server-side) and
--      never checked p_patient_id belonged to the caller.
--   c) slot_locks' UPDATE policy was `USING (true)` — unrestricted.
--   d) consultation_reports' SELECT policy compared against auth.uid(),
--      which is always NULL for Clerk JWTs (this project's documented
--      Clerk/Supabase auth mismatch) and its INSERT policy was
--      `with check (true)`.
--   e) reclaim_push_token() trusted a caller-supplied p_current_clerk_id
--      instead of deriving identity from the verified JWT.
--   f) book_appointment_slot() had no rate limiting (per audit section 16).

-- ── a) Guard trigger: block direct client tampering with financial/credit
-- columns on consultations ──────────────────────────────────────────────────
--
-- Named trg_00_... so it fires before trg_set_credit_on_decline (Postgres
-- fires same-timing triggers in alphabetical order by name) — this trigger
-- must see the client's raw submitted NEW, before that trigger's in-place
-- NEW.consultation_credit/credit_amount mutation runs for a legitimate
-- decline/cancel, or this trigger would mistake that legitimate change for
-- tampering.
--
-- Bypass conditions, verified against every UPDATE ... consultations in
-- supabase/migrations/:
--   - auth.role() = 'service_role': chapa-webhook, apply-credit, and
--     initialize-payment all write via the service-role client.
--   - auth.role() IS NULL: pg_cron-invoked functions (e.g.
--     cancel_stale_pending_payments, mark_doctor_missed_consultations) run
--     with no PostgREST request context at all, so auth.role() is unset —
--     these never touch the protected columns anyway, but the bypass covers
--     any future cron addition rather than only the current usage.
--   - public.is_admin(): kept for parity with the same pattern in
--     migration 056, in case a future write goes through an authenticated
--     admin session instead of the service-role client.
CREATE OR REPLACE FUNCTION public.guard_consultation_financial_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.role() IS NULL OR auth.role() = 'service_role' OR public.is_admin() THEN
    RETURN NEW;
  END IF;

  IF NEW.payment_status             IS DISTINCT FROM OLD.payment_status
     OR NEW.patient_amount          IS DISTINCT FROM OLD.patient_amount
     OR NEW.doctor_amount           IS DISTINCT FROM OLD.doctor_amount
     OR NEW.platform_amount         IS DISTINCT FROM OLD.platform_amount
     OR NEW.credit_used             IS DISTINCT FROM OLD.credit_used
     OR NEW.credit_source_id        IS DISTINCT FROM OLD.credit_source_id
     OR NEW.chapa_tx_ref            IS DISTINCT FROM OLD.chapa_tx_ref
     OR NEW.consultation_credit     IS DISTINCT FROM OLD.consultation_credit
     OR NEW.credit_amount           IS DISTINCT FROM OLD.credit_amount
     OR NEW.replacement_consultation_id IS DISTINCT FROM OLD.replacement_consultation_id
  THEN
    RAISE EXCEPTION 'FORBIDDEN: Payment and credit fields cannot be modified directly.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_00_guard_consultation_financial_columns ON public.consultations;
CREATE TRIGGER trg_00_guard_consultation_financial_columns
  BEFORE UPDATE ON public.consultations
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_consultation_financial_columns();

-- ── b) book_appointment_slot(): server-derived price + caller-identity
-- check + rate limiting ──────────────────────────────────────────────────────
-- Same signature as migration 083 (CREATE OR REPLACE in place). Changes:
--   1. p_patient_id must equal the caller's own verified identity (mirrors
--      the existing check in reschedule_appointment_slot).
--   2. p_patient_amount is no longer trusted — the real price is looked up
--      from doctor_profiles.{chat,phone,video}_price (required, non-null
--      fields set at doctor registration — app/(doctor)/registration/
--      step-4.tsx enforces all three before a doctor can submit) and used
--      for the insert and the existing commission-rate math instead.
--      Legitimate clients already send the exact matching price today, so
--      this changes nothing for a real booking; a tampered p_patient_amount
--      is now simply ignored.
--   3. A lightweight rate limit (10 attempts / 10 minutes per patient,
--      reusing the existing rate_limits table the rate-limit edge function
--      already uses for login/OTP) — generous enough to never interfere
--      with legitimate retry flows (SLOT_TAKEN, etc.).
CREATE OR REPLACE FUNCTION public.book_appointment_slot(
  p_patient_id       uuid,
  p_doctor_id        uuid,
  p_type             text,
  p_slot_start       timestamptz,
  p_slot_duration    int DEFAULT 20,
  p_patient_amount   numeric DEFAULT 0,
  p_doctor_amount    numeric DEFAULT 0,
  p_platform_amount  numeric DEFAULT 0,
  p_is_on_demand     boolean DEFAULT false
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_consultation_id  uuid;
  v_avail            jsonb;
  v_doctor_status    text;
  v_is_online        boolean;
  v_chat_price       numeric;
  v_phone_price      numeric;
  v_video_price      numeric;
  v_server_price     numeric;
  v_commission_rate  numeric;
  v_platform_amount  numeric;
  v_doctor_amount    numeric;
  v_doctor_busy      boolean;
  v_patient_busy     boolean;
  v_doctor_soon      boolean;
  v_rl_id            text;
  v_rl               public.rate_limits%ROWTYPE;
BEGIN
  IF p_patient_id IS DISTINCT FROM public.get_user_id_from_jwt_sub() THEN
    RAISE EXCEPTION 'FORBIDDEN: You can only book appointments for yourself.';
  END IF;

  -- Rate limit: 10 booking attempts / 10 minutes / patient, 30-minute lockout.
  v_rl_id := 'booking:' || p_patient_id::text;
  SELECT * INTO v_rl FROM public.rate_limits
    WHERE identifier = v_rl_id AND attempt_type = 'booking';

  IF v_rl.locked_until IS NOT NULL AND v_rl.locked_until > now() THEN
    RAISE EXCEPTION 'RATE_LIMITED: Too many booking attempts. Please try again shortly.';
  END IF;

  IF NOT FOUND OR v_rl.first_attempt_at < now() - interval '10 minutes' THEN
    INSERT INTO public.rate_limits (identifier, attempt_type, count, first_attempt_at, last_attempt_at, locked_until)
    VALUES (v_rl_id, 'booking', 1, now(), now(), NULL)
    ON CONFLICT (identifier, attempt_type) DO UPDATE
      SET count = 1, first_attempt_at = now(), last_attempt_at = now(), locked_until = NULL;
  ELSE
    UPDATE public.rate_limits
    SET count = count + 1,
        last_attempt_at = now(),
        locked_until = CASE WHEN count + 1 >= 10 THEN now() + interval '30 minutes' ELSE locked_until END
    WHERE identifier = v_rl_id AND attempt_type = 'booking';
  END IF;

  DELETE FROM public.slot_locks WHERE expires_at < now();

  IF p_slot_start < now() - interval '2 minutes' THEN
    RAISE EXCEPTION 'SLOT_EXPIRED: This time slot has already passed.';
  END IF;

  IF p_is_on_demand THEN
    SELECT EXISTS (
      SELECT 1 FROM public.consultations
      WHERE patient_id = p_patient_id
        AND status IN ('pending_payment', 'waiting_for_doctor', 'accepted', 'in_progress')
    ) INTO v_patient_busy;

    IF v_patient_busy THEN
      RAISE EXCEPTION 'PATIENT_BUSY: You already have an active consultation. Please finish it before starting a new one.';
    END IF;
  END IF;

  SELECT availability, status, is_online, chat_price, phone_price, video_price
  INTO v_avail, v_doctor_status, v_is_online, v_chat_price, v_phone_price, v_video_price
  FROM public.doctor_profiles WHERE id = p_doctor_id;

  IF v_doctor_status IS DISTINCT FROM 'approved' THEN
    RAISE EXCEPTION 'DOCTOR_UNAVAILABLE: This doctor is not currently available for booking.';
  END IF;

  v_server_price := CASE p_type
                       WHEN 'chat'  THEN v_chat_price
                       WHEN 'phone' THEN v_phone_price
                       WHEN 'video' THEN v_video_price
                     END;
  IF v_server_price IS NULL THEN
    RAISE EXCEPTION 'INVALID_PRICE: Unable to determine consultation price for this doctor.';
  END IF;

  IF p_is_on_demand THEN
    IF NOT COALESCE(v_is_online, false) THEN
      RAISE EXCEPTION 'DOCTOR_OFFLINE: This doctor is currently unavailable. Please choose another doctor.';
    END IF;

    SELECT EXISTS (
      SELECT 1 FROM public.consultations
      WHERE doctor_id = p_doctor_id
        AND status IN ('accepted', 'in_progress')
    ) INTO v_doctor_busy;

    IF v_doctor_busy THEN
      RAISE EXCEPTION 'DOCTOR_BUSY: This doctor is currently in another consultation. Please try again in a few minutes or choose another doctor.';
    END IF;

    v_doctor_soon := public.is_doctor_scheduled_soon(p_doctor_id);

    IF v_doctor_soon THEN
      RAISE EXCEPTION 'DOCTOR_SCHEDULED_SOON: This doctor has a scheduled consultation starting soon. Please choose another doctor or schedule a consultation.';
    END IF;
  ELSIF v_avail IS NOT NULL THEN
    PERFORM public._validate_scheduled_slot(v_avail, p_slot_start, p_slot_duration);
  END IF;

  v_commission_rate := public.get_commission_rate();
  v_platform_amount := round(v_server_price * v_commission_rate / 100);
  v_doctor_amount   := v_server_price - v_platform_amount;

  INSERT INTO public.consultations (
    patient_id, doctor_id, type,
    scheduled_at, status, payment_status,
    patient_amount, doctor_amount, platform_amount,
    is_on_demand
  )
  VALUES (
    p_patient_id, p_doctor_id, p_type,
    p_slot_start, 'pending_payment', 'pending',
    v_server_price, v_doctor_amount, v_platform_amount,
    p_is_on_demand
  )
  RETURNING id INTO v_consultation_id;

  BEGIN
    INSERT INTO public.slot_locks (doctor_id, slot_start, slot_duration, consultation_id)
    VALUES (p_doctor_id, p_slot_start, p_slot_duration, v_consultation_id);
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'SLOT_TAKEN: This time slot is no longer available. Please select another available time.';
  END;

  RETURN v_consultation_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.book_appointment_slot(uuid, uuid, text, timestamptz, int, numeric, numeric, numeric, boolean) TO authenticated;

-- ── c) slot_locks: drop the unrestricted UPDATE policy ──────────────────────
-- No client code anywhere calls .from('slot_locks').update(...) — every
-- write goes through book_appointment_slot()/reschedule_appointment_slot()
-- (SECURITY DEFINER, bypasses RLS as the table owner) or the service-role
-- webhook delete on payment failure. Nothing legitimate depends on this
-- policy; it only ever enabled availability-griefing (any authenticated
-- user could force-expire or extend any other doctor's lock).
DROP POLICY IF EXISTS "Allow updating own slot lock" ON public.slot_locks;

-- ── d) consultation_reports: fix broken SELECT + unrestricted INSERT ───────
-- reporter_clerk_id stores the raw Clerk sub (text), not users.id, so it's
-- compared directly against auth.jwt()->>'sub' — get_user_id_from_jwt_sub()
-- (used for the uuid patient_id/doctor_id checks below) returns users.id
-- and would never match a text clerk id.
DROP POLICY IF EXISTS "own reports" ON public.consultation_reports;
CREATE POLICY "own reports" ON public.consultation_reports
  FOR SELECT
  USING (reporter_clerk_id = (auth.jwt() ->> 'sub'));

DROP POLICY IF EXISTS "authenticated insert" ON public.consultation_reports;
CREATE POLICY "authenticated insert" ON public.consultation_reports
  FOR INSERT TO authenticated
  WITH CHECK (
    reporter_clerk_id = (auth.jwt() ->> 'sub')
    AND EXISTS (
      SELECT 1 FROM public.consultations c
      WHERE c.id = consultation_id
        AND (c.patient_id = public.get_user_id_from_jwt_sub() OR c.doctor_id = public.get_doctor_profile_id())
    )
  );

-- ── e) reclaim_push_token(): derive identity from the verified JWT ─────────
-- p_current_clerk_id kept in the signature for call-site compatibility with
-- lib/pushTokens.ts, but the function no longer trusts it — the identity
-- whose rows are protected from the null-out is now always the caller's own
-- verified clerk id, not a caller-chosen one.
CREATE OR REPLACE FUNCTION public.reclaim_push_token(
  p_column TEXT,
  p_token TEXT,
  p_current_clerk_id TEXT
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_clerk_id TEXT;
BEGIN
  v_caller_clerk_id := current_setting('request.jwt.claims', true)::json->>'sub';

  IF p_column NOT IN ('push_token', 'fcm_token', 'voip_token') THEN
    RAISE EXCEPTION 'reclaim_push_token: invalid column %', p_column;
  END IF;
  IF p_token IS NULL OR p_token = '' OR v_caller_clerk_id IS NULL OR v_caller_clerk_id = '' THEN
    RETURN;
  END IF;

  EXECUTE format(
    'UPDATE public.users SET %I = NULL WHERE %I = $1 AND clerk_id <> $2',
    p_column, p_column
  ) USING p_token, v_caller_clerk_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.reclaim_push_token(TEXT, TEXT, TEXT) TO authenticated;

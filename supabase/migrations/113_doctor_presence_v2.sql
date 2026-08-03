-- Migration: doctor_presence_v2
--
-- Problem: doctor_profiles.is_online never expires (migration 060 removed
-- every auto-offline mechanism as a deliberate product decision — a doctor
-- who force-quits/loses connectivity/dies-battery stays "Available Now"
-- forever). hooks/useDoctorPresenceHeartbeat.ts already writes last_seen_at
-- every 60s, but nothing reads it back — it only affects sort order.
--
-- Fix: introduce a real presence layer *on top of* is_online, which remains
-- the doctor's own explicit on/off preference and is never auto-flipped.
-- Presence ('available' | 'away' | 'busy' | 'offline') is computed
-- server-side from is_online + a heartbeat freshness window, and is the
-- authoritative gate for On-Demand booking inside book_appointment_slot().
--
-- Mobile/web safety: is_online, last_seen_at and book_appointment_slot() are
-- shared with carehub-web, which this change must not affect (explicit
-- product instruction — app-only improvement this round). Each heartbeat is
-- tagged with the writing platform; the away-by-staleness rule only ever
-- applies to doctors whose most recent heartbeat came from 'mobile'. Web
-- never calls update_doctor_heartbeat(), so a web-only doctor's
-- last_seen_platform stays NULL and get_doctor_presence() falls back to the
-- exact pre-existing is_online-only behavior for them.

ALTER TABLE public.doctor_profiles
  ADD COLUMN IF NOT EXISTS last_seen_platform text,
  ADD COLUMN IF NOT EXISTS last_seen_device text;

-- ── Heartbeat writer ─────────────────────────────────────────────────────
-- SECURITY DEFINER so last_seen_at is always server time, never a
-- client-supplied timestamp — a doctor client that could set its own
-- "last seen" would defeat the whole point of staleness detection.
CREATE OR REPLACE FUNCTION public.update_doctor_heartbeat(
  p_device   text DEFAULT NULL,
  p_platform text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.doctor_profiles
  SET last_seen_at       = now(),
      last_seen_device   = COALESCE(p_device, last_seen_device),
      last_seen_platform = COALESCE(p_platform, last_seen_platform)
  WHERE user_id = public.get_user_id_from_jwt_sub();
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_doctor_heartbeat(text, text) TO authenticated;

-- ── Presence calculation — single source of truth ───────────────────────
-- Mirrors is_doctor_busy()'s public/anon grant (migration 047): patients
-- need this to gate the booking UI before they're ever authenticated into
-- a doctor-scoped context.
CREATE OR REPLACE FUNCTION public.get_doctor_presence(p_doctor_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_online  boolean;
  v_status     text;
  v_last_seen  timestamptz;
  v_platform   text;
BEGIN
  SELECT is_online, status, last_seen_at, last_seen_platform
  INTO v_is_online, v_status, v_last_seen, v_platform
  FROM public.doctor_profiles
  WHERE id = p_doctor_id;

  IF NOT FOUND OR v_status IS DISTINCT FROM 'approved' OR NOT COALESCE(v_is_online, false) THEN
    RETURN 'offline';
  END IF;

  IF public.is_doctor_busy(p_doctor_id) THEN
    RETURN 'busy';
  END IF;

  IF v_platform = 'mobile' AND (v_last_seen IS NULL OR v_last_seen < now() - INTERVAL '2 minutes') THEN
    RETURN 'away';
  END IF;

  RETURN 'available';
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_doctor_presence(uuid) TO anon, authenticated;

-- ── book_appointment_slot(): on-demand gate now presence-aware ──────────
-- Same 9-param signature as the live version (migration 089, the latest of
-- several redefinitions after 062 — rate limiting, caller-identity check,
-- server-derived pricing, slot-expiry check, is_on_demand persistence, and
-- the is_doctor_scheduled_soon server-side check all carried forward
-- unchanged from 089's body below). Only the on-demand availability check
-- changes: is_online + a separate busy EXISTS query are replaced by a
-- single get_doctor_presence() call, which also rejects a stale mobile
-- heartbeat (still raised as DOCTOR_OFFLINE — same code the client already
-- handles) instead of only checking the raw toggle.
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
  v_chat_price       numeric;
  v_phone_price      numeric;
  v_video_price      numeric;
  v_server_price     numeric;
  v_commission_rate  numeric;
  v_platform_amount  numeric;
  v_doctor_amount    numeric;
  v_presence         text;
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

  SELECT availability, status, chat_price, phone_price, video_price
  INTO v_avail, v_doctor_status, v_chat_price, v_phone_price, v_video_price
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
    v_presence := public.get_doctor_presence(p_doctor_id);

    IF v_presence IN ('offline', 'away') THEN
      RAISE EXCEPTION 'DOCTOR_OFFLINE: This doctor is currently unavailable. Please choose another doctor.';
    ELSIF v_presence = 'busy' THEN
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

-- Phase 2 profile audit (2026-07-30), medium finding M-13.
--
-- app/(doctor)/(tabs)/profile.tsx and app/(doctor)/withdraw.tsx both fetched
-- every completed consultation's doctor_amount (all-time, plus a second full
-- fetch scoped to the current month on the profile screen) and summed them
-- client-side in JS, on every screen focus. As a doctor's consultation
-- history grows this transfers steadily more rows for a number that
-- Postgres can compute directly. This is a pure aggregation swap — the
-- displayed totals are unchanged, RLS already scoped these rows to the
-- caller's own consultations, and this function keeps the same scoping via
-- get_doctor_profile_id() rather than trusting a client-supplied doctor id.

CREATE OR REPLACE FUNCTION public.get_doctor_earnings_summary()
RETURNS TABLE(total_earned numeric, month_earned numeric)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    COALESCE(SUM(doctor_amount) FILTER (WHERE status = 'completed'), 0) AS total_earned,
    COALESCE(SUM(doctor_amount) FILTER (
      WHERE status = 'completed' AND ended_at >= date_trunc('month', now())
    ), 0) AS month_earned
  FROM public.consultations
  WHERE doctor_id = public.get_doctor_profile_id();
$$;

GRANT EXECUTE ON FUNCTION public.get_doctor_earnings_summary() TO authenticated;

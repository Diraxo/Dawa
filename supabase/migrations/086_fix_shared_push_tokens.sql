-- Migration 086: One-time cleanup for push/call tokens shared across accounts
--
-- Root cause of the "notifications reach the wrong logged-in account" bug:
-- push_token/fcm_token/voip_token identify a device+app-install, not an
-- account, but neither the doctor nor patient logout flow ever cleared them,
-- and token registration never checked whether the token already belonged
-- to a different user row. Switching accounts on one physical device (e.g.
-- testing with Expo Go logged in as different roles) left the previous
-- account's row still holding the same token indefinitely, so it kept
-- receiving pushes meant for whoever is signed in on that device now.
--
-- The client-side fix (clearPushTokens on logout, reclaimTokenFromOtherUsers
-- on registration — lib/pushTokens.ts) stops this going forward. This
-- migration cleans up rows that already drifted before that fix existed:
-- for any token value shared by more than one user row, keep it only on the
-- most-recently-updated row (the account most likely still signed in on
-- that device) and null it everywhere else.

WITH ranked_push AS (
  SELECT id, push_token,
         row_number() OVER (PARTITION BY push_token ORDER BY updated_at DESC NULLS LAST, created_at DESC) AS rn
  FROM public.users
  WHERE push_token IS NOT NULL
)
UPDATE public.users u
SET push_token = NULL
FROM ranked_push r
WHERE u.id = r.id AND r.rn > 1;

WITH ranked_fcm AS (
  SELECT id, fcm_token,
         row_number() OVER (PARTITION BY fcm_token ORDER BY updated_at DESC NULLS LAST, created_at DESC) AS rn
  FROM public.users
  WHERE fcm_token IS NOT NULL
)
UPDATE public.users u
SET fcm_token = NULL
FROM ranked_fcm r
WHERE u.id = r.id AND r.rn > 1;

WITH ranked_voip AS (
  SELECT id, voip_token,
         row_number() OVER (PARTITION BY voip_token ORDER BY updated_at DESC NULLS LAST, created_at DESC) AS rn
  FROM public.users
  WHERE voip_token IS NOT NULL
)
UPDATE public.users u
SET voip_token = NULL
FROM ranked_voip r
WHERE u.id = r.id AND r.rn > 1;

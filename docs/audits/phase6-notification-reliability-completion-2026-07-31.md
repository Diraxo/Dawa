# Phase 6 — Notification Infrastructure: Reliability, Multi-Device, Replay Protection Completion Report

**Date:** 2026-07-31
**Scope:** Implementation pass for 6 specific gaps identified in `phase5-notification-security-audit-2026-07-31.md` (H1, H4, M3, M4, and the VAPID configuration note in Appendix A). No redesign, no new notification types, no changes to the ~27 other Phase-5 findings (H2, H3, M1, M2, M5–M16) — those remain out of scope and untouched.

---

## 1. Root cause per issue

**Issue 1 — Multi-device push tokens.** `users.push_token`/`fcm_token`/`voip_token` (migration 028) are scalar columns — one value per account. A second device signing in overwrote the first device's token in each column; logging out on any one device nulled the columns every other device signed into that account was still relying on, since there was no per-device identity to clear selectively.

**Issue 2 — Reliable scheduled-reminder delivery.** Migration 105 flips `notification_sent`/`reminder_*_sent` TRUE in the same atomic UPDATE that claims a row, *before* `net.http_post` fires. If that HTTP call failed to enqueue, or the edge function errored (this exact class of failure — a drifted `INTERNAL_NOTIFICATION_SECRET` — has already caused two production incidents in this codebase's history, migrations 085→095→101), the row was already permanently marked sent with no retry. Separately, 3 of the 5 cron-driven notification paths (`process_followup_reminders`, `trigger_doctor_repeat_notifications`, `mark_running_late_consultations`) never received migration 105's atomic-claim fix at all and still had the original select-then-dispatch-then-flag-later TOCTOU race.

**Issue 3 — No retry for event-driven consultation notifications.** Every event fired through `_call_consultation_notification()` (accepted, declined, cancelled, completed, summary_ready, patient_joined, doctor_delayed, etc. — 13+ types) was a single fire-and-forget `net.http_post` with zero retry; only `new_request`'s existing 3-minute repeat cron self-healed.

**Issue 4 — No replay protection.** Both notification edge functions authenticated with only a static bearer secret compared via `===`. A captured request could be resent indefinitely with no nonce, timestamp, or expiration check.

**Issue 5 — Web push never configured.** The full web-push stack (schema, service worker, subscription hook wired into `AppointmentAlerts.tsx`, edge-function `web-push` integration) was already built and deployed, but `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`/`VAPID_SUBJECT` were never set as Supabase secrets, and `NEXT_PUBLIC_VAPID_PUBLIC_KEY` was absent from `carehub-web/.env.example` and (by strong circumstantial evidence — no reference anywhere in CI/deploy config) never set in Vercel either. Confirmed live via `supabase secrets list` before making any change — the three keys were genuinely absent, not just unverifiable from source.

**Bonus root cause found during this pass:** the separate, already-written-but-unapplied migration `107_patient_notification_completion_audit.sql` (predates this task, not part of the original 6 issues) had regressed `mark_running_late_consultations()`'s "doctor busy elsewhere" branch back onto the retired `carehub_service_role_key` vault secret instead of migration 085's `internal_notification_secret` — the exact same "`CREATE OR REPLACE FUNCTION` from a stale baseline" failure class that caused two prior production outages. Since 107 was never applied to the live database, this was fixed in place in that file rather than worked around, and the branch was also routed through the shared `_call_consultation_notification()` choke point instead of hand-rolling its own `net.http_post` + secret lookup, closing the drift risk structurally.

---

## 2–7. Files / functions / tables / migrations / edge functions / APIs changed

**New migrations:**
- `supabase/migrations/109_user_devices.sql` — `user_devices` table, RLS (own-rows SELECT only), `upsert_user_device()` and `deactivate_user_device()` SECURITY DEFINER RPCs (JWT-derived identity, mirrors `reclaim_push_token()`'s pattern).
- `supabase/migrations/110_notification_reliability.sql` — 8 new `consultations` columns (`notification_claimed_at`/`confirmed_at` + 3 reminder tiers each), `followup_reminders.claimed_at`, `notification_dispatch_log` table, `notification_request_nonces` table, redefines `_call_consultation_notification()`, `trigger_appointment_notifications()`, `trigger_appointment_reminders()`, `process_followup_reminders()`, `trigger_doctor_repeat_notifications()`, `mark_running_late_consultations()`; adds `retry_unconfirmed_appointment_notifications()` (5-min cron) and `retry_unconfirmed_consultation_notifications()` (2-min cron, includes nonce-table cleanup).

**Edited (unshipped, not part of the 6 issues but touched to fix a regression discovered en route):**
- `supabase/migrations/107_patient_notification_completion_audit.sql` — `mark_running_late_consultations()`'s vault-secret fix, described above. Still not applied to the live DB.

**Edge functions (both deployed live):**
- `supabase/functions/handle-consultation-notification/index.ts` — device fan-out (`getActiveDevices`, restructured `sendPushNotification`/`sendFCMDataMessage`/`sendAPNsVoIPPush` into `_xOnce` + fan-out-wrapper pairs, `sendCallCancelSignal` now device-aware), nonce/timestamp validation, `dispatch_log_id` confirm write-back, removed the "VoIP only if FCM didn't deliver" short-circuit (both channels now always attempted — correct once devices can be on mixed platforms).
- `supabase/functions/send-appointment-notification/index.ts` — same device fan-out pattern (duplicated per this file's existing "duplicated, not shared" design), `expoTargetsForUser()`/`logExpoPushErrors()` updated for mixed user/device recipient shape, nonce/timestamp validation, `*_confirmed_at` write-back alongside the existing `*_sent` write, same FCM/VoIP short-circuit removal.

**Client (mobile, additive only — no existing write path removed or altered):**
- `lib/deviceId.ts` (new) — persistent per-install UUID via `expo-crypto`.
- `lib/pushTokens.ts` — added `upsertDevice()`, `deactivateDevice()`.
- `hooks/usePushNotifications.ts` — registers the device row after the existing Expo token write.
- `lib/voipPush.ts` — registers the device row after the existing `fcm_token`/`voip_token` writes (initial + `onTokenRefresh`).
- `app/(patient)/(tabs)/profile.tsx`, `app/(doctor)/(tabs)/profile.tsx` — the 3 sign-out/deactivate call sites now also call `deactivateDevice()` for the current device only, alongside the existing (unchanged) `clearPushTokens()` account-wide call.

**Web:**
- `carehub-web/.env.example` — documented `NEXT_PUBLIC_VAPID_PUBLIC_KEY`.
- Supabase Edge Function secrets `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` set live (generated fresh key pair via `web-push generate-vapid-keys`).

**Docs:**
- This file, and `docs/audits/phase6-device-qa-checklist-2026-07-31.md`.

**APIs affected:** `handle-consultation-notification` and `send-appointment-notification` both now require two new headers (`X-Notification-Nonce`, `X-Notification-Timestamp`) on every call — every caller (all DB trigger functions, both new retry sweeps) was updated in the same migration, so there is no caller left on the old header shape. No client-facing API changed.

---

## 8. Retry mechanisms implemented

- **Scheduled reminders/start push** (Issue 2): claim-timestamp + confirm-timestamp columns per tier; `retry_unconfirmed_appointment_notifications()` re-attempts any claim stale >3 minutes without confirmation, every 5 minutes, bounded to a 2-hour lookback.
- **`process_followup_reminders`**: atomic claim via `claimed_at` staleness (3-minute reclaim window), self-contained — no separate sweep needed since the same 1-minute cron re-attempts stale claims on its next tick.
- **`trigger_doctor_repeat_notifications`, `mark_running_late_consultations`**: converted to the same atomic `UPDATE ... RETURNING` claim shape as migration 105, closing their TOCTOU duplicate-dispatch windows.
- **Event-driven consultation notifications** (Issue 3): generic `notification_dispatch_log` + `retry_unconfirmed_consultation_notifications()`, 2-minute cadence, 5-attempt cap, with an ordering guard that skips retrying a row if a later event for the same consultation already confirmed — prevents a stale retry from overwriting a newer, already-delivered status update.

## 9. Replay protection implemented

Every `net.http_post` call site (trigger-fired and both new sweeps) sends a fresh `gen_random_uuid()` nonce and a timestamp per HTTP attempt. Both edge functions reject requests with a missing/stale (>5 min either direction) timestamp, or a nonce already present in `notification_request_nonces` (insert-then-conflict, fail-closed on any DB error). Scoped to `handle-consultation-notification` and `send-appointment-notification` only, per the issue's own scope — not extended to `freeze-consultation-channel` or `notify-document-update-request`.

## 10. Multi-device support implemented

`user_devices` table, per-device RLS-gated SECURITY DEFINER RPCs, client registration on every token type (Expo/FCM/VoIP) additively alongside the legacy single-column writes, device-scoped logout, and fan-out at every send site in both edge functions with legacy-column fallback when a recipient has zero device rows (rollout safety — nothing regresses for users who haven't relaunched the updated app yet).

## 11. Manual testing performed

**None on physical devices** — this environment has no Android/iPhone hardware. What *was* verified:
- Both edited edge functions and all client files pass `esbuild`/`tsc` syntax checks with no new errors introduced (baseline pre-existing errors in unrelated files confirmed unchanged).
- Migrations 109 and 110 applied cleanly to the live linked database; the 3 new tables and both new cron jobs (`retry-unconfirmed-appointment-notifications` */5, `retry-unconfirmed-consultation-notifications` */2) confirmed present and active via direct query.
- Both edge functions deployed live and confirmed reachable (unauthenticated smoke request returns the expected 401/403, no secrets exposed in the check).
- VAPID secrets confirmed set on the live Supabase project post-deploy.

**Not done, and required before this can be called complete:** the entire device QA checklist (`phase6-device-qa-checklist-2026-07-31.md`) — every notification type × platform × app-state combination, the multi-device ring/fan-out behavior, the retry sweeps actually recovering from an injected failure, and replay-rejection behavior against a real captured request.

## 12. Remaining limitations

- **Web push is configured but not fully live**: `NEXT_PUBLIC_VAPID_PUBLIC_KEY` (public value: `BBsmCIawQmDOntAjU4vaSDhIHUMBPloR0pgRlravbQBQQFKbhf361dhbuLh1je9jy3wAX15GDhs34Ci5rsI0Zf4`) still needs to be added to the live Vercel project's environment variables and the site redeployed — without that, `useWebPushSubscription` continues to silently no-op exactly as before.
- **Legacy single-column fallback window**: a device that hasn't relaunched the updated app build still relies on `users.push_token`/`fcm_token`/`voip_token`, and `clearPushTokens()` (unchanged, still account-wide) can still null those out from a *different* device's logout during that narrow transition window — the bug this issue targets is fully closed only once both devices have registered at least one `user_devices` row each.
- **iOS VoIP/CallKit push credentials** (`APNS_KEY_ID`/`APNS_TEAM_ID`/`APNS_PRIVATE_KEY`) were not checked as part of this pass — prior project memory notes these were still missing as of the last release-blocker audit; if still unset, the iOS half of the multi-device ring test in the QA checklist cannot pass regardless of this work.
- **Migrations 107/108 remain unapplied** (pre-existing, unrelated to this task) — Doctor Joined/Left, Rating Reminder, `ended_abnormally`, and the "doctor never came online" notice are still not live. The one bug fixed inside 107 during this pass only prevents it from shipping broken *whenever* it is eventually applied — it does not make 107/108 live now.
- **No device QA has been performed** — see Section 11. Do not treat this work as verified end-to-end until the checklist is run.

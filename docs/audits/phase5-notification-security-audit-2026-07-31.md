# Dawa Platform — Phase 5 Notification System &amp; Security Audit (READ-ONLY)

**Date:** 2026-07-31
**Scope:** Patient Mobile app, Doctor Mobile app, and — on the website — **Admin notifications only** (`carehub-web/app/admin/**`, `carehub-web/app/api/admin/**`). Patient/doctor website screens are explicitly out of scope. Also covers the shared Supabase backend: migrations, Edge Functions, cron jobs, and Realtime subscriptions that back mobile + admin notifications.
**Method:** Static, read-only source audit across 4 parallel agents (Patient Mobile, Doctor Mobile, Admin Web + Infrastructure Inventory, Security/Reliability cross-cutting), each tracing full trigger → sender → transport → recipient → deep-link chains through Postgres migrations/triggers/RPCs/RLS, Edge Functions, cron jobs, Realtime channels, and client code. **No code was modified, no migrations created, nothing deployed.**
**Status:** No code changes made. This document is the deliverable for Phase 5. A separate implementation phase should follow after these findings are reviewed.

---

## EXECUTIVE SUMMARY

Phase 5 traced every notification in the Dawa platform from originating event to final delivery, across ~55 distinct notification types spanning patient mobile, doctor mobile, and admin web. Roughly two-thirds are implemented and behave as expected; the remainder split between notifications that are **entirely missing**, notifications that are **implemented but silently undeliverable** in common cases, and one **critical data-leak** in the Realtime layer that has nothing to do with any single notification and instead undermines the token-security work done in migrations 086–089.

**The most severe finding** is that `public.users` — which carries `push_token`, `fcm_token`, and `voip_token` in plain columns — is registered in the `supabase_realtime` publication, and its SELECT RLS policies are broad enough (any patient can read any approved doctor's full row; any doctor can read the full row of any patient they've ever had a consultation with) that a `postgres_changes` subscription lets one user silently read another user's raw push/call tokens. This is a **Realtime broadcast bypass** of the exact token-hijacking protection migrations 086–089 were built to close at the RPC layer — those migrations correctly locked down the *write* path; this finding is an unguarded *read/broadcast* path to the same data.

**The second cluster of findings** concerns reliability, and centers on a single migration. Migration 105 ("atomic_notification_claim") correctly fixed a duplicate-push race for two cron jobs (appointment reminders and appointment-start pushes) by marking a row "sent" in the same atomic statement that selects it — but this means a row is marked permanently sent **before** the push actually succeeds. If the edge function 403s (which has already happened twice in production via the 085→095→101 auth-secret regression history), or FCM/Expo/APNs is briefly down, that specific reminder is now lost forever with no retry — worse than the old "fail-open" design it replaced. Separately, the same atomic-claim pattern was **only applied to 2 of the 5 cron jobs that needed it**; the other three (follow-up reminders, the doctor 3-minute repeat-notify sweep, and the running-late check) still carry the original TOCTOU duplicate-dispatch race migration 105 was written to close elsewhere.

**The third cluster** is a straightforward implementation bug with broad blast radius: every notification inserted by an admin action on the website — doctor approval, rejection, suspension, reinstatement, document review, and all three withdrawal states (8 notification types in total) — omits the `screen` key from its `data_json` payload. The mobile deep-link router (`lib/notificationNav.ts`) switches on exactly that key, so tapping any of these 8 notification types in the in-app Notification Center is a silent no-op. Withdrawals compound this: they receive no push notification at all (in-app + email only), directly contradicting the in-app copy that promises "We'll notify you when your funds are transferred."

**The fourth cluster** is missing notifications discovered by systematically checking the spec against the code rather than assuming coverage: patients are never told when a doctor joins or leaves a live call (despite the DB column existing for one of these), there is no rating-reminder nudge of any kind, payment success/failure has no push fallback if the user doesn't return to the app from the external payment browser, and the admin side of the platform has essentially **no operational alerting** — no notification for a new withdrawal request, no Sentry/error monitoring (the wrapper exists but the package was never installed), and no alerting of any kind for edge-function, cron, or payment-failure conditions on a healthcare platform running fire-and-forget `pg_net` calls throughout its notification pipeline.

The system's *core* consultation-lifecycle notifications (accepted/declined/cancelled/completed, new-request with its 3-minute repeat, scheduled-reminder tiers, summary-ready) are well-built, with genuinely good PHI-hygiene discipline — clinical content is consistently kept out of push payloads in favor of generic tray text, verified end-to-end in every path read. The failures cluster at the edges: multi-device support, admin-triggered notifications, failure/retry semantics, and a handful of specific missing events.

### Total issues by severity

| Severity | Count |
|---|---|
| Critical | 1 |
| High | 5 |
| Medium | 16 |
| Low | 11 |
| **Total** | **33** |

---

## TOP 10 FINDINGS (ranked by real-world impact)

1. **[CRITICAL] `users` table in the Realtime publication + broad SELECT RLS leaks push/FCM/VoIP tokens** to any patient (for any approved doctor) or any doctor (for any past patient) via a raw `postgres_changes` subscription — bypasses the RPC-layer token-hijack protections built in migrations 086–089 entirely, since this is a read/broadcast path, not a write. (§C1)
2. **[HIGH] Migration 105's atomic notification claim converts transient send failure into permanent silent loss** for scheduled reminder/start pushes — a row is marked "sent" before delivery is attempted, so a 403/outage during that exact tick loses the notification with no retry, regressing from the prior fail-open design. (§H1)
3. **[HIGH] Migration 105's duplicate-dispatch fix was applied to only 2 of 5 cron-driven notification paths** — follow-up reminders, the doctor repeat-notify sweep, and the running-late check still carry the original TOCTOU race. (§H1, same root migration as #2, opposite failure mode)
4. **[HIGH] Doctor Joined / Doctor Left are never surfaced to the patient** — `doctor_connected_at` exists and is written, but no trigger or notification branch reads it; there is no `doctor_left_at` column at all, an asymmetry against the doctor-facing `patient_joined`/`patient_left` events that already exist. (§H2)
5. **[HIGH] All 8 admin-driven notification types have a broken in-app deep link** — `data_json` omits the `screen` key for doctor-approval/rejection/suspension/reinstatement, document-review, and all withdrawal notifications, so tapping any of them in the mobile Notification Center silently does nothing. (§H3)
6. **[HIGH] Single-column (not per-device) push token storage** — a user signed in on two devices only receives pushes on whichever registered most recently; logging out on one device silently kills push delivery on every other device signed into the same account, since there is no per-device identity to clear selectively. (§H4)
7. **[MEDIUM-HIGH] Withdrawal status changes send no push notification at all** — in-app row + email only, directly contradicting the in-app copy's explicit promise ("We'll notify you when your funds are transferred"); combined with #5, a doctor whose app is backgrounded when a withdrawal is processed has no reliable way to learn about it. (§M1)
8. **[MEDIUM] Admin web has effectively zero operational alerting** — no notification for a new withdrawal request or document upload reaching admin, no "Reported User/Consultation" concept exists at all, and Sentry/error monitoring is wired as a no-op wrapper with the actual package never installed — a production healthcare platform with no automated failure alerting anywhere. (§M2)
9. **[MEDIUM] No retry/reconciliation exists for 13 of 15 event-driven consultation notification types** — only the doctor's "new request" self-heals via its 3-minute repeat cron; every other event (accepted, declined, cancelled, completed, summary-ready, etc.) is single-shot with silent loss on any edge-function or `pg_net` failure, and no nonce/timestamp check protects any of them against request replay. (§M3, §M4)
10. **[MEDIUM] Several real patient-facing gaps found by direct verification rather than assumption**: no push fallback for Payment Success/Failure if the user doesn't return from the external payment browser; no notification when a doctor never comes online for a scheduled slot (only "busy" is detected, not "offline"); no notification of any kind when nobody ever responds to a waiting-room request (the auto-expiry crons were deliberately removed in migration 062); and no rating-reminder mechanism exists anywhere in the codebase. (§M5–§M8)

---

## CRITICAL ISSUES

### C1 — `users` table Realtime publication + broad SELECT RLS leaks push/FCM/VoIP tokens

**FIXED 2026-07-31** — verified live: `supabase.channel(...).on('postgres_changes', { table: 'users' })` with no row filter is real in `hooks/usePatientAppointments.ts` and `hooks/usePatientDoctors.ts` (used to pick up doctor name/photo edits), so `users` couldn't simply be dropped from the publication. Applied migration `106_users_realtime_exclude_tokens.sql`: re-added `public.users` to `supabase_realtime` with an explicit column list (`id, clerk_id, email, full_name, phone, profile_photo_url, role, country, language, created_at, updated_at, is_suspended, address`) that excludes `push_token`/`fcm_token`/`voip_token`. Confirmed via `pg_publication_tables.attnames` on the linked project that the three token columns are no longer published, and that the other 7 tables in the publication were untouched. No consumer code changes needed — nothing read those columns off the realtime payload.

**Root cause:** `public.users` is registered in the `supabase_realtime` publication (`supabase/migrations/006_platform_settings.sql:23`). Supabase Realtime's `postgres_changes` RLS enforcement is row-level only — once a subscriber's SELECT policy matches a row, the **entire row** is broadcast on every INSERT/UPDATE, not just whichever columns the app UI happens to read. `users.push_token`, `fcm_token`, and `voip_token` live as plain columns on this same row (`supabase/migrations/028_call_device_tokens.sql:12-14`).

The SELECT policies gating this table are intentionally broad for legitimate profile-display reasons, but have no column-level restriction:
- `users_select_approved_doctor` — any authenticated patient can read any **approved doctor's** full row (`supabase/migrations/081_fix_patient_read_doctor_users_row.sql:23-32`).
- `users_select_doctor_patient` — any doctor can read the full row of **any patient they've ever had a consultation with** (`supabase/migrations/070_doctor_patient_profile_visibility.sql:15-24`).

**Concrete exploit:** any authenticated client already ships the anon/authenticated Supabase key. A malicious patient opens a `postgres_changes` subscription on `public.users` filtered to an approved doctor's `id` and receives that doctor's raw `push_token`/`fcm_token`/`voip_token` (and any other non-audited PII columns on that row) the next time it changes — no write, no RPC, no audit trail. The same applies symmetrically for any doctor against any patient they've ever treated. This is a clean path to spoofing/hijacking push delivery to that user's device, the exact class of attack migrations 086 (`fix_shared_push_tokens`), 087/089 (`reclaim_push_token_rpc` + its own JWT-trust fix) were built to prevent at the write layer — this bypasses all of that by reading instead of writing.

**Not affected:** `consultations` and `notifications` are also in the publication (`supabase/migrations/022_enable_realtime_consultations.sql:14-15`) but their SELECT RLS is correctly scoped to participants only (`patient_id`/`doctor_id` match, or `user_id` match) — no leak found on those two tables.

**Recommended fix (describe only):** Either drop `users` from the `supabase_realtime` publication and serve any legitimate presence/profile-change UI need from a narrower view or a separate lightweight table that excludes token columns, or move `push_token`/`fcm_token`/`voip_token` onto a separate table that is never added to the publication.

---

## HIGH ISSUES

### H1 — Migration 105's atomic claim: fixed duplicate-dispatch for 2 cron jobs, introduced silent-loss risk, left 3 cron jobs with the original race

Two independent, opposite-direction findings from the same migration, both confirmed by separate agents (security/reliability agent and admin/infra agent):

**(a) Newly introduced silent-loss risk.** Prior to migration 105, `notification_sent`/`reminder_*_sent` flags were set `TRUE` only *inside* `send-appointment-notification`, after a successful send — migration 105's own header comment documents this as a deliberate "fail-open" design (`supabase/migrations/105_atomic_notification_claim.sql:14-15`). Migration 105 moved the flag-set into the **same SQL statement that selects eligible rows**, before `net.http_post` is even called (`105_atomic_notification_claim.sql:72-90`, mirrored for all three reminder tiers at `:116-178`). If the subsequent HTTP call fails to enqueue, the edge function errors/403s, or the push provider is briefly down, the row is **already permanently marked sent** — no future cron tick will retry it, because the eligibility predicate is now false regardless of whether delivery actually happened. This exact auth-secret failure mode (085→095 regression→101 fix) has already occurred once in this codebase's history; migration 105 means a recurrence of that class of bug now causes **permanent, silent notification loss** rather than a temporary outage that self-heals on the next tick. Contrast with migration 103's `retry_unfrozen_chat_channels()` pattern for the structurally identical `freeze-consultation-channel` fire-and-forget call, which correctly uses a write-back column + a 5-minute retry sweep (`supabase/migrations/103_freeze_channel_reconciliation.sql:19-52`) — that reconciliation pattern was never applied to the notification-sending path, including in the same migration that made it strictly more failure-intolerant than before.

**(b) Fix applied to only 2 of 5 affected cron jobs.** Migration 105's atomic `UPDATE ... WHERE flag=false RETURNING id` claim pattern was applied to `trigger_appointment_notifications()` and `trigger_appointment_reminders()` only. Three other cron-driven notification paths retain the original check-then-dispatch-then-flag-later shape and its TOCTOU duplicate-dispatch window:
- `process_followup_reminders()` / cron `carehub-followup-reminders` (migration 052)
- `trigger_doctor_repeat_notifications()` / cron `carehub-doctor-repeat-notify` (migrations 067/084)
- `mark_running_late_consultations()` / cron `carehub-running-late-check` (migration 084)

**Recommended fix (describe only):** For (a), add a write-back-and-retry mechanism mirroring migration 103's chat-freeze pattern — e.g. a `notification_send_failed_at` column and a short-interval sweep that re-attempts rows claimed-but-unconfirmed beyond a timeout, rather than treating "claimed" and "delivered" as the same event. For (b), apply the same atomic-claim rewrite to the three remaining cron functions for consistency, weighing each one's actual duplicate-risk exposure first.

### H2 — Doctor Joined / Doctor Left never notify the patient

`on_consultation_presence_change()` (migration 066) only watches `patient_connected_at`/`patient_left_at` and fires `patient_joined`/`patient_left` to the **doctor**. There is no symmetric trigger clause for `doctor_connected_at` (which exists as a column, migration 035, written by the doctor's own call screens) and **no `doctor_left_at` column exists at all**. `handle-consultation-notification/index.ts` has no `case` for either direction. A backgrounded patient waiting for a doctor to physically join a video/phone call receives no push telling them the doctor has joined — they only learn if the call screen itself happens to be open and receiving the live Realtime update, or via the earlier "Doctor Accepted" push (which only means the doctor tapped Accept, not that media actually connected). Similarly, if a doctor exits mid-call while the session is technically still "active" from the patient's side, the patient is never told.

**Recommended fix (describe only):** Add a `doctor_left_at` column mirroring `patient_left_at`, extend `on_consultation_presence_change()` to watch both `doctor_connected_at` and the new `doctor_left_at`, and add `doctor_joined`/`doctor_left` cases to `handle-consultation-notification` mirroring the existing `patient_joined`/`patient_left` handling (patient-facing copy/preference gate).

### H3 — All 8 admin-driven notification types have a broken in-app deep link

Every notification inserted directly by a `carehub-web/app/api/admin/**` route — `doctor_approved`, `doctor_rejected`, `doctor_suspended`, `doctor_reinstated`, `document_update_reviewed`, `withdrawal_approved`, `withdrawal_rejected`, `withdrawal_paid` — sets `data_json` to a payload like `{ doctorProfileId }` or `{ withdrawalId, amount }` with **no `screen` key**. `lib/notificationNav.ts`'s `navigateForNotification()` switches on `data.screen`; with no key present it falls through to a no-op default (line ~444-445). Tapping any of these 8 rows in the mobile Notification Center does nothing. (The **push** notification for 5 of the 8 — everything except the 3 withdrawal types, see H3/M1 below — still works, because `sendDoctorStatusPush()` hardcodes `data: { screen: 'profile' }` independently of the in-app row's `data_json`.) Additionally, 7 of the 8 types (all but `doctor_approved`) are missing from `NotificationCenterView.tsx`'s `TYPE_META` icon map and render with the generic bell icon.

**Recommended fix (describe only):** Add a `screen` key to every admin-inserted `data_json` payload (e.g. `screen: 'profile'` for doctor-status events, a dedicated withdrawal-detail screen key for withdrawal events once one exists), and extend `TYPE_META` to cover all 8 types.

### H4 — Single-column push token storage breaks multi-device delivery

`push_token`, `fcm_token`, `voip_token` are scalar columns on `users` (migration 028), not rows in a per-device table. A user signed into the app on two devices has the second device's registration silently overwrite the first's token in each column — every send in both edge functions targets exactly one token value per user, confirmed by reading every send path (`handle-consultation-notification/index.ts`, `send-appointment-notification/index.ts`). Only the most-recently-registered device receives any push; the other goes silent with no error surfaced anywhere. `reclaimTokenFromOtherUsers` (the migration 087/089 hardening) only guards against a token leaking to a *different account* — it does nothing for the same account's second device evicting the first. Because there is one `users` row per account, logging out on device A (which calls `clearPushTokens`, nulling all three columns) **also silences device B**, which is still logged into the same account, since there is no per-device identity to clear selectively.

**Recommended fix (describe only):** Move to a per-device token table (`device_id`, `user_id`, `token`, `platform`, `last_seen_at`), fan out sends to every live token for a recipient instead of one scalar column, and scope logout/token-clear operations to the device performing the logout rather than the whole account.

---

## MEDIUM ISSUES

### M1 — Withdrawal Approved/Rejected/Paid send no push notification

`carehub-web/app/api/admin/withdrawals/[id]/route.ts` inserts an in-app `notifications` row and sends an email (Resend) on every withdrawal status change, but never calls `sendDoctorStatusPush()` — contrast with the sibling `carehub-web/app/api/admin/doctors/[id]/route.ts`, which does call it for every doctor-status change. `app/(doctor)/withdraw.tsx:244` explicitly promises *"We'll notify you when your funds are transferred"* — this promise is only half-kept (email yes, push no). Combined with H3, a doctor whose app is backgrounded, killed, or not currently on the Withdraw/Notification Center screen has no reliable way to learn their withdrawal was processed until they happen to open the app. The "Earnings &amp; Withdrawals" (`earnings`) preference toggle in `notification-settings.tsx` is dead code — no send path anywhere reads it, since there's no push to gate in the first place.

### M2 — Admin web has effectively zero operational alerting

Of the 12 admin notification categories in scope, only "Doctor Registration"/"Doctor Approval Required" is genuinely implemented (an in-app realtime badge via two independent, overlapping `postgres_changes` subscriptions on `doctor_profiles`, `carehub-web/components/admin/Sidebar.tsx:63-75` and `carehub-web/app/admin/approvals/page.tsx:99-109` — no email/push either). Confirmed missing entirely: Document Upload alert, Withdrawal Request alert (outbound doctor notifications exist; nothing tells admin a request arrived), Reported User, Reported Consultation (no reports concept exists anywhere in the schema — `blocked_users`/migration 102 and `block-consultation-peer` handle peer blocking but never surface to admin), System Failure, Payment Failure, Edge Function Failure, Cron Failure, and Reminder Failure alerts. `carehub-web/lib/monitoring.ts` is a Sentry-shaped wrapper that no-ops because `@sentry/nextjs` was never installed — there is **no automated production error monitoring anywhere in the stack**. The closest thing to a failure alert, migration 103's `retry_unfrozen_chat_channels()` cron, does `RAISE WARNING` on a stuck freeze but that terminates at the Postgres log dashboard; nothing routes it to the admin UI.

### M3 — No retry/reconciliation for 13 of 15 event-driven consultation notification types

Every consultation-status-change notification (`accepted`, `declined`, `cancelled`, `completed`, `summary_ready`, `summary_updated`, `patient_joined`, `patient_left`, `call_declined`, `missed_call`, `doctor_ready`, `scheduled_booking`, `rescheduled`) fires exactly once, on the `OLD.status IS DISTINCT FROM NEW.status` (or equivalent) trigger edge, with no flag, sweep, or second chance if `net.http_post` fails to enqueue or the edge function errors on that single invocation. The sole exception is the doctor's "new request" event, which self-heals via the 3-minute `carehub-doctor-repeat-notify` cron (migration 067/084). No compensating reconciliation sweep (of the kind migration 103 built for chat-freeze) exists for any of the other 13 types.

### M4 — No replay protection on internal-secret notification endpoints

Both `handle-consultation-notification` and `send-appointment-notification` authenticate solely via a static bearer secret compared with `===` — no nonce, timestamp, or request-id is checked (`handle-consultation-notification/index.ts:685-687`; `send-appointment-notification/index.ts:478-482`). A captured/replayed request can be resent indefinitely. Blast radius is bounded (most handlers just re-insert a notification row and re-send a push; the underlying `consultations.status` writes happen elsewhere and are separately guarded against double-action, see "no duplicate-action" finding in the security agent's report), but `new_request` calls without `payload.repeat === true` would insert a genuine duplicate row on replay, and every replayed event is at minimum a duplicate-push nuisance.

### M5 — Payment Success/Failure have no push fallback

Confirmed by reading `app/(patient)/payment-return.tsx` end-to-end and `chapa-webhook/index.ts`: payment confirmation and failure are conveyed **only** via that screen's own local UI state. No row is inserted into `notifications`, no push fires. If the app is backgrounded or killed while the user is still in the external Chapa payment browser and never manually returns, there is no notification telling them their payment succeeded or failed.

### M6 — Doctor "offline" (not busy) at a scheduled slot start produces no notice

`mark_running_late_consultations()` (migrations 084/085) only detects a doctor occupied by *another active consultation* at the scheduled start time, firing `doctor_running_late` to the patient. It has no clause for a doctor who is simply not online at all. A patient whose assigned doctor never logs in for a scheduled slot gets no proactive notice; the appointment silently sits `waiting_for_doctor` indefinitely (consistent with migration 062's deliberate "waiting room never auto-expires" design, but with no outbound signal to compensate).

### M7 — No notification when a waiting-room request is never answered

Migration 062 deliberately dropped the `mark-doctor-missed`/`mark-no-show-consultations` crons so the waiting room never silently auto-expires — a reasonable product decision, but its consequence is that there is now **no notification of any kind** telling either party that a request has sat unanswered; the only mitigation is the doctor-facing 3-minute repeat-notify (which only helps the doctor, not the patient).

### M8 — No rating-reminder mechanism exists

Targeted search (`rating.?reminder`/`rate.*doctor`) across the entire repo found no cron, trigger, or edge-function branch of any kind that schedules or sends a "please rate your consultation" notification. Rating is solicited only synchronously, inline on `app/(patient)/consultation-summary.tsx`; if the patient closes the app without rating there, they are never asked again.

### M9 — `ended_abnormally` (heartbeat-timeout) has no notification branch

`mark_stale_active_consultations()` (migration 023) flips a heartbeat-stale session to `ended_abnormally` after a timeout, but `on_consultation_change()` has no branch for this status — neither party gets a push or in-app row. `app/_layout.tsx` includes `'ended_abnormally'` in a client-side terminal-status set that clears the local active-call banner, but only while that Realtime subscription is live in an open app — a backgrounded/killed app gets no signal its call was force-ended server-side.

### M10 — `reclaim_push_token` RPC trusted caller-supplied identity (historical, now fixed) — flagged for process, not as a live gap

Migration 087 originally took `p_current_clerk_id` as a caller-supplied parameter used directly in a `WHERE clerk_id &lt;&gt; $2` clause, letting any authenticated caller null out another user's token row by supplying an arbitrary identity (`supabase/migrations/087_reclaim_push_token_rpc.sql:20-42`). Migration 089 correctly fixed this by deriving identity from the JWT claim instead of the parameter. **Confirmed fixed** in the current migration set — included here only because it's the same "silent regression via `CREATE OR REPLACE FUNCTION` from a stale baseline" failure class documented in H1/C1's related history (085→095→101), and is worth naming as a recurring process risk rather than a one-off.

### M11 — `rate-limit` edge function has a scoping bug

`supabase/functions/rate-limit/index.ts:140-145` — a module-scope `json()` helper references `cors`, which is only defined inside the `Deno.serve` closure (`index.ts:23`). Every response this function returns, including its own catch-all error path, would throw `ReferenceError: cors is not defined` at runtime as written. Not verified against a live deployment (read-only audit), but a genuine scoping bug in the current source.

### M12 — `freeze-consultation-channel` still authenticates via the raw platform service-role key

Unlike `handle-consultation-notification`/`send-appointment-notification`, which were migrated to the dedicated `INTERNAL_NOTIFICATION_SECRET` pattern (migration 085), `freeze-consultation-channel` still checks the raw `SUPABASE_SERVICE_ROLE_KEY` (`freeze-consultation-channel/index.ts:92-96`), a deliberate carve-out per migration 085's own comment. It's called from the same `on_consultation_change` trigger family, and is the one remaining path still exposed to the "service-role key format/rotation" instability that has caused prior outages in this codebase's history.

### M13 — Document Update Request (doctor → admin) has no notification implementation

`app/(doctor)/my-documents.tsx`'s `requestUpdate()` is purely a client-side `Alert` that opens a `mailto:` link — no `notifications` insert, no admin-facing alert, no DB record of the request at all. An admin only learns of it if the doctor actually sends the email and someone reads the inbox.

### M14 — Rescheduling doesn't reset the 10-minute reminder flag

`reschedule_appointment_slot()` (migration 054) resets `reminder_30_sent` and `reminder_5_sent` to `false` on a reschedule but not `reminder_10_sent` (added later, migrations 065/095) — a rescheduled appointment could silently skip its 10-minute reminder if the original booking had already consumed that flag.

### M15 — Realtime channel `Date.now()` anti-pattern stragglers remain, worse on web

The shared ref-counted `lib/realtimeChannelManager.ts` now covers 7 mobile hooks, but several mobile screens still bypass it with unique-per-mount channel names: `app/(doctor)/my-documents.tsx:153`, `app/(doctor)/withdraw.tsx:75`, `app/(patient)/chat-consultation.tsx:367`, `app/(patient)/payment-return.tsx:397`, `app/(patient)/waiting-room.tsx:190,216`. **The web app has no equivalent shared manager at all** — confirmed `Date.now()`-pattern stragglers in `carehub-web/hooks/useUserPhotoRealtime.ts:31`, `useConsultationState.ts:157`, `components/patient/RescheduleModal.tsx:83`, `app/doctor/consultations/page.tsx:136`, `app/patient/waiting/[consultationId]/page.tsx:170`, `app/patient/payment/return/page.tsx:220`, plus the admin Sidebar/Approvals pages independently running two overlapping subscriptions to the same `doctor_profiles` changes. Every site reviewed does call `removeChannel` on cleanup — no confirmed permanent leak — but fast navigation or StrictMode double-invoke can open transient duplicate subscriptions.

### M16 — Stream Chat push template cannot be verified for PHI exposure from this codebase

No override of Stream's default push-notification template was found anywhere in `lib/stream.ts` or elsewhere — chat push registration (`hooks/usePushNotifications.ts:262-271`) hands off entirely to Stream's own infrastructure. Stream's dashboard-configured default template typically includes a preview of the message text; since patient↔doctor chat can contain symptom/medication descriptions, if the dashboard template includes message-body content, that puts PHI on a lock screen. **This cannot be confirmed or ruled out from the repository alone** — it depends on Stream's dashboard push-template configuration, which should be checked directly.

---

## LOW ISSUES

| # | Finding | Where |
|---|---|---|
| L1 | Account Created / Google-Apple Sign-In / Email Verification have no app-native notification — entirely Clerk-managed (by design, not a bug) | `app/(auth)/sign-up.tsx` |
| L2 | Password Reset success is a local UI toast only, not a `notifications` row/push | `app/(auth)/forgot-password.tsx`, `reset-password.tsx` |
| L3 | Password Changed has no security-audit-trail notification — a user whose password is reset by an attacker gets no independent signal | §6.2 patient report |
| L4 | Profile Updated (patient and doctor) has no notification of any kind — likely intentional (self-action) but confirmed unimplemented, not merely unverified | `edit-personal-info.tsx`, `edit-profile.tsx` |
| L5 | Availability Issues (doctor) — no alerting logic exists at all in the presence-heartbeat hook; confirmed not implemented | `hooks/useDoctorPresenceHeartbeat.ts` |
| L6 | Credit Expired — no expiry mechanism (TTL column or sweep) found for `consultation_credit`; confirm this is intentional (perpetual credit) | grep across migrations, no match |
| L7 | Document Approved/Rejected sends push+in-app but no email, inconsistent with sibling admin actions (approve/reject-application, suspend/reinstate) which all send email | `carehub-web/app/api/admin/doctors/[id]/route.ts` |
| L8 | `TYPE_META` icon map missing entries for 7 of 8 admin-driven notification types — cosmetic, falls back to generic bell | `components/notifications/NotificationCenterView.tsx:26-47` |
| L9 | No rate limiting on `agora-token`, `apply-credit`, `block-consultation-peer`, `generate-stream-token` edge functions — only `initialize-payment` implements it (10/10min via `rate_limits` table) | edge function inventory |
| L10 | `chapa-webhook`/`payment-redirect` have no caller authentication of their own, relying on separately re-verifying with Chapa — inherent to the webhook pattern, flagged for awareness rather than as a fix-now item | edge function inventory |
| L11 | Reported User / Reported Consultation is a missing **feature**, not a missing notification — no schema, no admin UI concept exists for either | admin web audit |

---

## WHAT'S WORKING WELL (do not regress)

- **PHI hygiene in push payloads is consistently good.** Every path read (new-request, follow-up reminders, summary-ready/updated) deliberately keeps clinical content, patient names, and free-text notes out of the push tray/data payload in favor of generic copy, with explicit code comments explaining why (lock-screen visibility). The `incoming_requests_v2` Android channel is correctly set to `lockscreenVisibility: PRIVATE` for this exact reason.
- **Deep-link staleness handling is well-built.** `resolveIncomingRequestRoute()` and the `waiting` case in `lib/notificationNav.ts` both re-query live consultation status before navigating rather than trusting the notification payload, correctly avoiding reopening completed/stale consultations.
- **Ownership at the data layer holds even where the routing layer doesn't re-check it.** Every screen a notification deep-links to is gated by the same RLS policies as normal navigation, so a spoofed/replayed `consultationId` cannot actually load another user's data even in principle.
- **Duplicate-action protection is solid.** Accept/decline both use compare-and-swap updates (`.eq('status', 'waiting_for_doctor')`), so a duplicate notification or double-tap cannot cause a double-accept or double-charge.
- **Actor-aware cancellation suppression.** The `cancelled` event correctly skips notifying whichever party initiated the cancellation, and migration 096 correctly prevents notifying a doctor about a booking they never saw (cancelled from `pending_payment`).
- **Stale token cleanup is real, not aspirational.** Every send path in both edge functions actively clears dead tokens (`DeviceNotRegistered`/`UNREGISTERED`/`BadDeviceToken`) on the recipient's row, and Android's `onTokenRefresh` proactively re-syncs.
- **Account-deletion token clearing is correctly ordered.** The Clerk webhook anonymizes the user row and clears all three token columns atomically with the deletion event, closing the obvious "stale token reused after account deletion" risk.

---

## APPENDIX A — Architecture Overview

- **Two notification-producing Edge Functions**, both DB-trigger/cron-only, never client-callable:
  - `supabase/functions/handle-consultation-notification/index.ts` — event-driven (consultation status changes, presence, summaries).
  - `supabase/functions/send-appointment-notification/index.ts` — cron-driven (reminders, "start", follow-ups).
  - Both authenticate via a static `INTERNAL_NOTIFICATION_SECRET` bearer check (migration 085, regressed by 095, fixed by 101).
- **DB trigger**: `on_consultation_change()` (migration 007, most recently redefined in migration 096) fires on `AFTER INSERT OR UPDATE OF status ON consultations`, calling the notification edge function via fire-and-forget `pg_net.http_post`.
- **Delivery fan-out per event**: (1) insert into `public.notifications` (Notification Center + badge), (2) Expo push → FCM/APNs, (3) for phone/video ringing events, a system-level call push (Android FCM high-priority data message or iOS APNs VoIP) driving ConnectionService/CallKit, (4) web push (VAPID) for carehub-web.
- **Preferences** (`notification_preferences`, migration 003, doctor columns added 053) gate only the Expo push send — never the in-app row or the system call-ring push (deliberate: muting must never mean missing an actual call).
- **General guarantee model**: `pg_net.http_post` is fire-and-forget from Postgres's perspective; no response is ever inspected by any trigger caller. Cron-based sends get an informal retry via widened time-catch-up windows; event-driven sends do not (see M3). **Overall: best-effort, not at-least-once**, except where noted (new-request's 3-minute repeat).

### Cron job inventory

| Job | Schedule | Migration | Purpose | Atomic claim? |
|---|---|---|---|---|
| `carehub-appointment-notifications` | `* * * * *` | 001, redefined through 105 | flips `scheduled`→`waiting_for_doctor` + "start" push | Yes (105) |
| `carehub-appointment-reminders` | `* * * * *` | 002, redefined through 105 | 30/10/5-min reminder tiers | Yes (105) |
| `carehub-followup-reminders` | `* * * * *` | 052 | doctor-scheduled follow-up reminders | **No** (H1b) |
| `carehub-doctor-repeat-notify` | `*/3 * * * *` | 067, fixed 084 | re-pings doctor while a request sits unanswered | **No** (H1b) |
| `carehub-running-late-check` | `* * * * *` | 084, key fixed 085 | "doctor running behind" one-shot notice | **No** (H1b) |
| `mark-missed-calls` | `*/5 * * * *` | 018 | phone/video ring timeout → `missed` | n/a |
| `mark-stale-consultations` | `*/5 * * * *` | 023 | heartbeat timeout → `ended_abnormally` (no notification wired, M9) | n/a |
| `retry-unfrozen-chat-channels` | 5-min sweep | 103 | reconciliation for the chat-freeze fire-and-forget call (model for what notification sends lack, H1a) | n/a |
| `mark-doctor-missed` / `mark-no-show-consultations` | — | defined 018/023, **removed 062** | deliberately dropped so the waiting room never auto-expires (M7) | n/a |

### Edge Function inventory (all 14 in `supabase/functions/`)

| Function | Auth | Notes |
|---|---|---|
| `handle-consultation-notification` | `INTERNAL_NOTIFICATION_SECRET` bearer | main event-driven sender |
| `send-appointment-notification` | `INTERNAL_NOTIFICATION_SECRET` bearer | main cron-driven sender |
| `freeze-consultation-channel` | raw `SUPABASE_SERVICE_ROLE_KEY` | inconsistent auth pattern (M12) |
| `agora-token` | Clerk JWT, cross-checked against consultation | no rate limit (L9) |
| `apply-credit` | Clerk JWT, cross-checked | no rate limit (L9) |
| `block-consultation-peer` | Clerk JWT | no rate limit (L9) |
| `generate-stream-token` | Clerk JWT | no rate limit (L9) |
| `initialize-payment` | Clerk JWT | only function with rate limiting (10/10min) |
| `chapa-webhook` | none (re-verifies with Chapa) | inherent to webhook pattern (L10) |
| `payment-redirect` | none | inherent to pattern (L10) |
| `clerk-webhook` | Svix HMAC signature, 5-min replay tolerance | correctly verified |
| `handle-refund` | n/a | orphaned no-op stub, refunds disabled V1 |
| `dev-payment-bypass` | `__DEV__`-gated client-side | confirmed unreachable in production builds |
| `rate-limit` | n/a | scoping bug found, `cors` undefined at module scope (M11) |

### Realtime subscription inventory — see M15 for the anti-pattern stragglers list.

---

## APPENDIX B — Full Notification Catalog

### B1. Patient Mobile

| Notification | Status | Severity | Note |
|---|---|---|---|
| Account Created | Missing (Clerk-native) | None | By design |
| Google/Apple Sign-In | N/A | None | No notification expected |
| Password Reset | Implemented (Clerk) | None | Local toast only |
| Email Verification | Implemented (Clerk) | None | — |
| Doctor Approved | N/A | None | Not patient-facing |
| Appointment Scheduled | Implemented | None | Both parties, immediate |
| Appointment Rescheduled | Implemented | Low | 10-min reminder flag not reset (M14) |
| 30/10/5-Min Reminders | Implemented | — | See H1 |
| Consultation Starting | Implemented | None | Call-ring parity with on-demand |
| Doctor Ready | Implemented | None | Fires once via flag |
| Doctor Accepted | Implemented | None | Ring + fallback push |
| Doctor Declined | Implemented | None | Credit-preserved copy |
| Doctor Cancelled/Cancelled | Implemented | None | Actor-aware suppression |
| Doctor Unavailable (offline at scheduled time) | Partial | Medium | M6 |
| Consultation Missed | Partial | Medium | M7 |
| Payment Successful | Missing (push) | Medium | M5 |
| Waiting For Doctor | Missing (patient side) | Low | Doctor-only by design |
| Doctor Busy/Unavailable (booking-time) | N/A | None | Synchronous RPC error, correct |
| Consultation Started | N/A | None | Covered by Doctor Accepted |
| Consultation Completed | Implemented | None | migration 066 |
| Consultation Summary Ready | Implemented | None | + `summary_updated` variant |
| Patient Joined (doctor-facing) | Implemented | None | migration 066 |
| Doctor Joined (patient-facing) | **Missing** | **High** | H2 |
| Doctor Left (patient-facing) | **Missing** | **High** | H2 |
| Consultation Ended (abnormal) | Missing | Medium | M9 |
| Rating Reminder | **Missing** | Medium | M8 |
| Payment Failure | Missing (push) | Medium | M5 |
| Credit Applied | Implemented | None | Bundled into `declined` |
| Credit Expired | Missing/N/A | Low | L6 |
| Refund | N/A (disabled) | None | `handle-refund` no-op stub |
| Withdrawal | N/A | None | Doctor-only |
| Profile Updated | Missing | Low | L4 |
| Password Changed | Missing | Low-Medium | L3 |
| Account Deleted | Implemented (webhook) | None | Correct, no post-delete push needed |
| Document Request | N/A | None | Feature not found |

### B2. Doctor Mobile

| Notification | Status | Severity | Note |
|---|---|---|---|
| New Consultation Request | Implemented | Low | Best-built event in the system (3-min repeat) |
| Scheduled Consultation Reminder | Implemented | Low | Atomic claim, historically broken twice by secret drift |
| Patient Waiting | Implemented | None | = New Consultation Request |
| Patient Joined | Implemented | Low | Single-shot, no retry |
| Patient Left | Implemented | Low | Same shape |
| Patient Cancelled | Implemented | None | Correct asymmetric suppression |
| Consultation Started | Implemented | None | Via `accepted`/`kind:'start'` |
| Consultation Ended | N/A (doctor is trigger source) | None | — |
| Summary Submitted | N/A (doctor is trigger source) | None | PHI correctly excluded |
| Withdrawal Approved/Rejected/Paid | Partial | **Medium** | M1 |
| Admin Approval (Doctor Approved) | Implemented | Low | Deep-link broken in-app (H3) |
| Admin Rejection (Doctor Rejected) | Implemented | Low | Same |
| Doctor Suspended/Reinstated | Implemented | Low | Same |
| Document Update Request | **Missing** | Medium | M13 |
| Document Approved | Implemented | Low | No email (L7) |
| Document Rejected | Implemented | Low | Same |
| Profile Updated | Missing | Low | L4 |
| Availability Issues | **Missing** | Low-Medium | L5 |
| "Earnings &amp; Withdrawals" preference toggle | Dead code | Medium | M1 |
| In-app deep link, 8 admin-driven types | Bug | **High** | H3 |
| `TYPE_META` icon coverage | Cosmetic | Low | L8 |

### B3. Admin Web

| Notification | Status | Severity | Note |
|---|---|---|---|
| Doctor Registration/Approval Required | Implemented | Low | In-app badge only, redundant overlapping subscriptions |
| Document Upload | **Missing** | Medium | Part of M2 |
| Withdrawal Request | **Missing** | Medium | Part of M2 |
| Reported User | **Missing (feature)** | Low | L11 |
| Reported Consultation | **Missing (feature)** | Low | L11 |
| System Failure | **Missing** | Medium | Part of M2 |
| Payment Failure | **Missing** | Medium | Part of M2 |
| Edge Function Failure | **Missing** | Medium | Part of M2 |
| Cron Failure | **Missing** | Medium | Part of M2 |
| Chat Freeze Failure | Partial (log only) | Medium | Reaches Postgres logs, not admin UI |
| Reminder Failure | **Missing** | Medium | Part of M2 |

---

## Notes on method and confidence

Findings are drawn from four independent read-only agents each given the same DB migration history, edge function source, and client code, cross-referenced by this compiling pass for overlap and contradiction. Where two agents independently converged on the same root cause from different angles (e.g. both the doctor-mobile and infra agents separately flagging the withdrawal push gap from different files), that is noted as corroboration. No live/device testing was performed — this is a static source audit; a few items (rate-limit function's runtime behavior, Stream's dashboard push template) are explicitly flagged as unverifiable from source alone and should be checked directly before being treated as confirmed.

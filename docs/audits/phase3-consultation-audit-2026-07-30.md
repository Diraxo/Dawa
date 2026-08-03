# Dawa Mobile — Phase 3 Consultation System Audit (READ-ONLY)

**Date:** 2026-07-30
**Scope:** Mobile app only (Android/iOS, Expo/React Native). `carehub-web` excluded.
**Method:** Static, read-only source audit across 5 parallel agents, each tracing full execution paths (Supabase queries/RPCs, Edge Functions, Realtime subscriptions, Stream Chat events, Agora events, notifications, DB triggers/migrations). No code was modified, no commits made, no migrations created.
**Status:** No code changes made. This document is the deliverable for Phase 3.

---

## EXECUTIVE SUMMARY

Phase 3 traced the entire consultation lifecycle — purchase, waiting room, doctor incoming request, chat/voice/video, completion, cancellation, recovery, timers, notifications, security, performance, edge cases, and the underlying database — across five parallel read-only audits. **30 issues** were found, including **2 Critical** and **4 High** severity items that materially affect either security or the reliability of a live consultation. Two of the Critical/High findings are notification and security **regressions** — cases where a *later* migration or code path silently undid a fix from an earlier phase (the July vault-secret and error-latch fix history repeating itself in a new function). One Critical finding is a genuine, previously-undiscovered security gap in the Agora token-issuance endpoint that allows a participant in a call to impersonate the other participant's connection identity.

The consultation system's core financial/status-integrity controls (payment idempotency, slot-lock lifecycle, status-transition guard triggers, financial-column tamper guards) are strong and were verified correct. The weaker areas are: (1) authorization gaps in real-time media/chat channels that go beyond row-level DB security, (2) silent failure modes in vault-secret-dependent server-side notification/freeze paths (a repeating architectural risk in this codebase), and (3) UI-level dead/cosmetic features (Block, Clear Chat) that imply protections the app does not actually provide.

### Total issues by severity

| Severity | Count |
|---|---|
| Critical | 2 |
| High | 4 |
| Medium | 12 |
| Low | 12 |
| **Total** | **30** |

(Two findings carry a hybrid rating — e.g. "Low/Medium" or "Medium-High" — because the auditing agent flagged genuine uncertainty pending runtime/deployment verification; each is counted once, in its higher band, above.)

### Top 10 production blockers

1. **[CRITICAL] Agora token endpoint doesn't bind `uid` to caller identity** (§5/6) — a participant can mint a token for the *other* party's uid and force-disconnect them mid-call.
2. **[CRITICAL] Migration 095 silently reverted the vault-secret fix for appointment-start/reminder notifications** (§10/11) — scheduled-consultation-start and reminder pushes likely fail silently again.
3. **[HIGH] Scheduled bookings have no patient-busy check** (§1/2) — a patient can end up with two simultaneously-active consultations across two different doctors.
4. **[HIGH] Video call screens have no recovery path for a local Agora join failure**, and the doctor's video screen's rejoin effect wouldn't even fire on retry (§5/6).
5. **[HIGH] No app-level authorization gate before watching a Stream chat channel** — protection currently depends entirely on Stream dashboard config, which the codebase's own history suggests may not be safely locked down (§4/12).
6. **[HIGH] Duplicate "new chat request" notification** when the doctor's app is foregrounded (§3/11).
7. **[MEDIUM-HIGH] `freeze-consultation-channel`'s vault-secret dependency has the identical staleness/silent-failure shape** as the Critical #2 finding, just for a different secret (§4/12) — if it drifts, completed-consultation chats are never actually frozen server-side.
8. **[MEDIUM] Patient can silently overwrite the doctor's canonical PDF report**; the storage bucket's write policy has no role distinction (§7).
9. **[MEDIUM] Doctor consultation-history/list queries are unbounded and unpaginated**, refetched in full on every tab focus/realtime event/foreground (§13).
10. **[MEDIUM] Chat attachments have no file-type/size validation** — any file type can be sent through a medical consultation channel (§4).

### Areas verified as correct

- Slot-lock lifecycle (trigger-driven, race-proof) — migration 075.
- Payment verification/idempotency — `chapa-webhook`, `apply-credit`, `initialize-payment`, `dev-payment-bypass`.
- Financial-column and status-transition tamper guards — migrations 089, 091/092/097.
- `handle-refund` confirmed a deliberate no-op (credits are the real refund mechanism, correctly wired).
- Waiting-room cancellation uses a blocklist (not allowlist) so new terminal statuses can't strand the Cancel button.
- Consultation-recovery routing re-checks on foreground/reconnect/every navigation, deferring to screens that own their own realtime nav.
- Realtime publications correctly configured for `consultations`/`notifications`/`slot_locks`.
- Doctor Accept and Complete double-tap protections (client guard + idempotent DB writes + transition-guard trigger).
- `agora-token`, `generate-stream-token` edge functions correctly verify caller identity/ownership before issuing tokens (aside from the uid-binding gap above).
- `consultation_summaries` RLS correctly restricts writes to the assigned doctor only.
- Video error-latch (prior bug) genuinely fixed — clears on peer join.
- `startPreview()`/`enableVideo()` ordering fix, self-view black-screen fix (RtcTextureView on Android), camera/mic permission requests, camera-off persistence, adaptive cloud-proxy fallback, token renewal, engine singleton lifecycle/teardown — all verified correct.
- Stream Chat Clerk-ID-vs-UUID membership bug (prior finding) confirmed fixed everywhere.
- Single Stream connection lifecycle, typing/read-receipt/presence handling, server-side chat freeze (when it fires) all verified correct.
- Vault-secret consistency verified correct for `_call_consultation_notification`, `mark_running_late_consultations`, `process_followup_reminders` (unlike the two regressed functions in Critical #2).
- Cross-transport notification dedup for background/killed-app "new request" alerts; stale/ghost-call guards; doctor busy/offline handling; multi-incoming-request queueing; single incoming-request-screen enforcement.

### Areas requiring runtime/device verification

- Live confirmation of Finding #1 (Agora uid impersonation) and #2 (vault secret mismatch) against the actually-deployed edge functions/vault contents — both are unambiguous from source but unverified live.
- Whether Stream's `messaging` channel-type dashboard policy actually denies non-member channel access (Finding #5) — not inspectable from the repo.
- Real network-loss, camera/mic hardware, and killed-app/cold-launch recovery behavior for voice/video (needs physical devices).
- Whether Android's native Telecom/ConnectionService imposes its own ring timeout independent of the JS layer.
- Several narrow client-side races (chat-request dedup, `checkForWaitingRequest` dedup) that are plausible from code but need timing-precise device tests to confirm they manifest.
- Whether `consultation_summaries.consultation_id` actually has a UNIQUE constraint (not present in tracked migrations — the table appears to have been created outside migration history).

### Recommended implementation order (for a future fix phase — not executed now)

1. **Migration 095 vault-secret regression** — single corrective migration, highest impact-to-effort ratio, restores a currently-silent notification outage.
2. **Agora token uid-binding fix** — isolated edge-function change, closes a live security/DoS gap.
3. **Scheduled-booking patient-busy check** — closes a booking-integrity gap with real financial/UX consequences.
4. **Video call recovery UI + doctor video screen's stale effect-dependency fix** — restores parity with the phone-call recovery UX.
5. **Stream chat channel authorization** — verify Stream dashboard config; add an app-level authorization gate if it's not safely locked down.
6. **Vault-secret reconciliation/monitoring** across both the notification (#2) and freeze-channel (#7) call paths, since they share the same silent-failure architecture — worth fixing as one class of problem.
7. **`consultation-reports` storage bucket** — restrict write to doctor-only, add size/MIME validation.
8. **Chat attachment validation** — reuse the existing `validateFile()` helper.
9. **Notification/UX parity fixes** — duplicate chat-request notification, doctor "Cancel outgoing call" status write, Android ring-timeout parity.
10. **Performance pass** — consultation-list pagination, list virtualization, remaining realtime-singleton stragglers, server-clock-based call timers.
11. **Cosmetic/dead-code cleanup** — Clear Chat button, Block-feature persistence (or removal), full-history chat search, duplicated Stream watch-logic consolidation.

---

## SECTION 1 — Consultation Purchase Flow / SECTION 2 — Waiting Room / SECTION 8 — Cancellation / SECTION 9 — Recovery / SECTION 15 — Database

### Finding P3-01 — No cross-doctor conflict check for scheduled (non-on-demand) bookings lets a patient hold two simultaneously-active consultations
**Severity:** High

**Root cause:** `book_appointment_slot()`'s patient-busy check only runs `IF p_is_on_demand`. For scheduled bookings, nothing checks whether the patient already has another `pending_payment`/`scheduled`/`waiting_for_doctor`/`accepted`/`in_progress` row.

**Evidence:**
- `supabase/migrations/089_security_hardening.sql:171-181` — the `PATIENT_BUSY` check is entirely inside the `p_is_on_demand` branch.
- `supabase/migrations/066_queue_order_and_missing_notifications.sql:39-65` / `085_internal_notification_secret.sql:136-162` — the cron that flips `scheduled → waiting_for_doctor` only guards that the **doctor** has no other active row, nothing checks the patient.
- `supabase/migrations/061_credit_on_doctor_missed_and_accept_busy_and_stale_sweep.sql:52-82` — blocks a second accept for the *same* doctor, not two different doctors accepting two rows for the *same* patient.
- Confirmed no patient-level uniqueness exists: only `uq_consultations_doctor_slot` (doctor+slot_start) exists anywhere in the migrations.

**Files/Functions:** `supabase/migrations/089_security_hardening.sql` (`book_appointment_slot`), `066_queue_order_and_missing_notifications.sql`/`085_internal_notification_secret.sql` (`trigger_appointment_notifications`, `_activate_next_queued_for_doctor`), `lib/activeConsultationRecovery.ts` (`resolveActiveConsultationRoute`), `hooks/useActiveConsultationRecovery.ts`.

**DB tables:** `consultations`, `slot_locks`. **APIs:** `book_appointment_slot` RPC.

**User/Security impact:** `resolveActiveConsultationRoute()` only queries the single most-recently-created active row (`.order('created_at', desc).limit(1)`), so the older concurrent consultation is silently orphaned from automatic recovery. One doctor can end up "waiting alone" for a patient occupied elsewhere, resolving only via the 10-minute stale-session sweep. The product's stated "one active consultation at a time" invariant is unenforced for the scheduled path.

**Reproduction:** As one patient, book scheduled chat consultations with two different doctors at overlapping times. Both pass `book_appointment_slot()` (different doctors, so the doctor-slot unique index doesn't block it), both get activated independently by the per-minute cron, both doctors can independently Accept.

**Recommended fix (description only):** Add a patient-busy check to the scheduled branch of `book_appointment_slot()` too, and/or add the same "no other active row" guard for the patient into the queue-activation cron. Update `resolveActiveConsultationRoute()` to handle or surface more than one concurrently-active row.

---

### Finding P3-02 — Waiting room has no timeout for a doctor who never responds
**Severity:** Low (deliberate, documented design decision)

**Root cause:** Migration `062_remove_waiting_room_timeouts_and_busy_gap.sql` deliberately removed `mark_doctor_missed_consultations()` and its cron, explicitly stating "the waiting room must never disappear on its own." `doctor_missed` is now dead code (unreachable, but the enum/UI still reference it).

**Evidence:** `supabase/migrations/062_...sql:1-45`; `app/(patient)/waiting-room.tsx:110-113` documents "no server-side auto-expiry."

**Impact:** A crashed/offline/ignoring doctor leaves the patient waiting indefinitely with no doctor-offline signal in the UI (waiting-room's realtime subscription on `doctor_profiles` never tracks `is_online`); the only exit is the manual Cancel button (which correctly preserves credit).

**Recommended fix:** Not asking to reverse the deliberate no-auto-expiry design — but consider surfacing the doctor's live `is_online` status in the waiting-room UI so patients can make an informed cancel decision.

---

### Finding P3-03 — `consultation_summaries.consultation_id` uniqueness cannot be confirmed from migration history
*(Cross-listed from Section 7 — see P3-19.)*

### Areas verified as correct (Sections 1/2/8/9/15)
1. Slot-lock lifecycle fully trigger-driven and race-proof (migration 075).
2. Payment verification/idempotency is solid (`chapa-webhook` idempotent status guard, immediate slot release on failure, scoped resilience fallback).
3. `book_appointment_slot()` closes real tampering vectors (caller-identity check, server-derived price, rate limiting).
4. Financial/status tampering blocked by layered triggers, not just RLS (migrations 089, 091/092/097).
5. `apply-credit`/`initialize-payment`/`dev-payment-bypass` verify JWT + row ownership, use conditional updates safe under concurrent claims.
6. `handle-refund` confirmed a deliberate no-op; credit system is the real refund mechanism and is correctly wired.
7. Waiting-room cancellation blocklist (not allowlist) design.
8. Payment-return screen: multi-mount dedup, race-safe status-flip guard, routes off live DB status.
9. `useActiveConsultationRecovery`/`activeConsultationRecovery.ts` re-checks on foreground/reconnect/every navigation, deferring to screen-owned navigation.
10. Realtime publications correctly configured; prior `slot_locks` RLS bug already fixed (migration 080).

### Areas requiring runtime/device verification
- Live reproduction of P3-01 (two overlapping scheduled bookings, different doctors).
- Chapa webhook delivery reliability in production (infra-dependent).
- `mark_stale_active_consultations` cron actually running (pg_cron schedule/vault secret health).
- Device-level waiting-room dual realtime+poll behavior under real network flakiness; deep-link resolution race in `payment-return.tsx`.

---

## SECTION 3 — Doctor Incoming Consultation / SECTION 10 — Timers / SECTION 11 — Notifications

### Finding P3-04 — Migration 095 silently reverted the vault-secret fix for appointment-start/reminder pushes
**Severity:** Critical

**Root cause:** Migration 085 moved every DB-trigger caller of the notification edge functions off the unstable `carehub_service_role_key` vault secret onto a dedicated `internal_notification_secret`, matching the edge functions' auth checks. Migration 095 (`095_fix_reminder_early_firing.sql`), written later to fix an unrelated reminder-timing bug, was apparently based on a pre-085 copy of `trigger_appointment_notifications()`/`trigger_appointment_reminders()` and reintroduces the old `carehub_service_role_key` lookup via `CREATE OR REPLACE FUNCTION`.

**Evidence:**
- `supabase/migrations/095_fix_reminder_early_firing.sql:54-60, 96-103` — both functions read `vault.decrypted_secrets WHERE name = 'carehub_service_role_key'`.
- `supabase/functions/send-appointment-notification/index.ts:478-482` — requires `bearerToken === Deno.env.get('INTERNAL_NOTIFICATION_SECRET')`.
- No migration after 095 (096-100, including untracked 098/099/100) touches these two functions again.

**Files/Functions:** `supabase/migrations/095_fix_reminder_early_firing.sql`, `085_internal_notification_secret.sql` (contrast), `supabase/functions/send-appointment-notification/index.ts`. Functions: `trigger_appointment_notifications()`, `trigger_appointment_reminders()`.

**DB tables:** `consultations`, `vault.decrypted_secrets`. **Edge Function:** `send-appointment-notification`.

**User impact:** Every "consultation starting now" push and every reminder tier (30/10/5-minute, both patient and doctor) silently stops being delivered — `net.http_post` is fire-and-forget, so a 403 rejection surfaces nowhere.

**Security impact:** None directly (fails closed), but a silent availability regression matching the exact bug class already fixed once (July 17 vault-key mismatch, July 18 outage).

**Reproduction:** Inspect the live function body (`pg_get_functiondef`) — confirm it references `carehub_service_role_key`; confirm that secret's value differs from `internal_notification_secret`'s.

**Recommended fix (description only):** New migration re-applying 085's `internal_notification_secret` lookup to both functions while preserving 095's timing-window fix. Consider a regression test that greps future migrations for `carehub_service_role_key` reappearing in any of the five functions 085 fixed.

---

### Finding P3-05 — Duplicate "new chat request" notification when the doctor's app is foregrounded
**Severity:** High

**Root cause:** Two independent code paths call `Notifications.scheduleNotificationAsync` for the same event (a chat consultation becoming `waiting_for_doctor`) with no shared identifier/dedup marker: (1) `lib/voipPush.ts:221-249`'s FCM foreground handler, which writes an AsyncStorage marker; (2) `app/(doctor)/(tabs)/home.tsx:63-76` (`ringIncomingRequest`), triggered by Home's own realtime subscription/poll/AppState-resume, which never checks that marker.

**Evidence:** `lib/voipPush.ts:221-249`; `app/(doctor)/(tabs)/home.tsx:63-76, 308-412, 421-451`.

**Files/Functions:** `_handleIncomingRequestData`, `ringIncomingRequest`, `checkForWaitingRequest`. **DB tables:** `consultations`. **Realtime:** `doctor-requests-${doctorProfileId}`.

**User impact:** A doctor with the app open on Home sees two near-identical tray notifications plus a vibration ring for one incoming chat request.

**Recommended fix:** Have `ringIncomingRequest`/`checkForWaitingRequest` check the same `@incoming_request_displayed_${consultationId}` marker, or pass a deterministic `identifier` to both `scheduleNotificationAsync` calls.

---

### Finding P3-06 — Call-duration timers are not device-clock-independent
**Severity:** Medium

**Root cause:** `hooks/useConsultationState.ts` computes elapsed call time from the raw device clock (`Date.now()`) rather than the server-corrected clock the codebase already has available via `lib/serverClock.ts`'s `useServerNow()` (used elsewhere for booking/slot math, never wired into call timers).

**Evidence:** `hooks/useConsultationState.ts:74-75, 107, 111`.

**Files:** `hooks/useConsultationState.ts`, `lib/serverClock.ts`, `components/consultation/CallInfoPanel.tsx`, `components/ui/ActiveCallBanner.tsx`.

**User impact:** A device with a materially wrong clock shows a call duration disagreeing with the peer's device and reality, including a discontinuous jump if the clock self-corrects mid-call.

**Recommended fix:** Thread `useServerNow()`'s offset into `useConsultationState`'s `now` computation.

---

### Finding P3-07 — Android has no client-side incoming-call ring timeout
**Severity:** Low/Medium

**Root cause:** `lib/callkeep.ts:322-335`'s auto-end-if-unanswered logic (60s) is explicitly `Platform.OS === 'ios'` only. Android's only backstop is the server-side `mark_missed_calls()` sweep (5-minute cron, up to ~10 min worst case).

**Evidence:** `lib/callkeep.ts:322-335`; `supabase/migrations/078_fix_missed_call_connect_race.sql`; `018_no_show_handling.sql:77-81`.

**User impact:** Asymmetric platform behavior — an Android incoming call can ring far longer than iOS's 60s before resolution.

**Recommended fix:** Add an Android-side `setTimeout` mirroring iOS's 60s auto-end, or shorten the DB sweep interval.

---

### Finding P3-08 — Repeat-notify cron can re-alert a doctor already on the Accept/Decline screen
**Severity:** Low

**Root cause:** Foreground-notification suppression only checks `useActiveConsultationScreenStore`, which is set only by the four *accepted*-consultation screens — never by `app/(doctor)/incoming-request.tsx`. Migration 067's 3-minute repeat cron re-fires the full push flow regardless.

**Evidence:** `hooks/usePushNotifications.ts:49-58`; `app/(doctor)/incoming-request.tsx`; `supabase/migrations/067_repeat_doctor_notification_while_waiting.sql`.

**Recommended fix:** Extend suppression to also check `useActiveIncomingRequestStore.shownRequestId`.

---

### Finding P3-09 — `waiting-room.tsx` still uses `Date.now()`-suffixed realtime channel names
**Severity:** Low

**Evidence:** `app/(patient)/waiting-room.tsx:190, 216` — bypasses the singleton `subscribeRealtime`/`realtimeChannelManager.ts` pattern used elsewhere. Matches prior-session memory of "3 stragglers remain on Date.now()."

**Recommended fix:** Migrate to the singleton/ref-counted manager.

---

### Finding P3-10 — Possible narrow race in `checkForWaitingRequest`'s dedup guard
**Severity:** Low, needs verification

**Root cause:** `shownConsultationIds.current.add(waiting.id)` runs only after two `await`s; independent triggers (poll/realtime/AppState-resume) could theoretically both pass the "not yet shown" check before either adds to the set.

**Evidence:** `app/(doctor)/(tabs)/home.tsx:308-412`. Not concretely reproduced — flagged as plausible, unconfirmed.

### Areas verified as correct (Sections 3/10/11)
- Vault-secret consistency correct for `_call_consultation_notification`, `mark_running_late_consultations`, `process_followup_reminders` (unaffected by the migration-095 regression).
- Cross-transport dedup for background/killed-app "new request" alerts.
- Stale/ghost-call guards re-verify live status before/after displaying CallKeep/ConnectionService UI.
- Doctor busy/offline handling (`is_doctor_busy` RPC gate, clean `DOCTOR_BUSY` UX).
- Multiple-incoming-requests queueing; single incoming-request-screen enforcement.
- Repeat-notification row collapsing (updates existing row rather than inserting duplicates).
- Real (non-hardcoded) badge counts; Android notification-channel immutability handling (`_v2` bump pattern).
- Waiting room has no live elapsed timer (static estimate only) — no clock-drift concern there.
- The original reminder timing-window bug that 095 was meant to fix is correctly implemented in the SQL logic itself; only the vault-secret regression undermines it.

### Areas requiring runtime/device verification
- Whether `carehub_service_role_key` and `internal_notification_secret` currently hold different values in the live project.
- Actual FCM/APNs background/killed-app delivery on physical devices (Doze mode, OEM battery managers, APNs VoIP entitlement).
- Whether Android's native Telecom/ConnectionService imposes its own ring timeout.
- Exact timing/interleaving of FCM vs. Realtime delivery (duplicate chat-notification reproducibility).
- The narrow `checkForWaitingRequest` dedup race.

---

## SECTION 4 — Chat Consultation (Stream Chat)

### Finding P3-11 — "Search Messages" silently searches only the locally-loaded message page
**Severity:** Medium

**Root cause:** Both chat screens filter `activeChannel.state.messages` (SDK's in-memory paginated cache) instead of issuing a server-side Stream search query.

**Evidence:** `app/(doctor)/chat-consultation.tsx:749-760`; `app/(patient)/chat-consultation.tsx:860-871`.

**User impact:** Searching for a message earlier than the last-loaded page returns "No messages found" even though it exists, with no indication only recent messages were searched.

**Recommended fix:** Use Stream's server-side `channel.search()`/`client.search()`, or explicitly scope the UI to "recent messages" and force-load full history first.

---

### Finding P3-12 — "Block" feature is cosmetic-only; nothing is persisted or enforced
**Severity:** Medium

**Root cause:** `isBlocked` is local component state only; never written to any table, never propagated to Stream (no mute/block/member removal). No `blocked_users`/`is_blocked` table exists anywhere in migrations.

**Evidence:** `app/(doctor)/chat-consultation.tsx:189, 862`; `app/(patient)/chat-consultation.tsx:288, 1079`.

**User impact:** Tapping "Block" disables the composer for the current screen instance only; navigating away/back or restarting silently un-blocks with no persistence, and the other party is never actually prevented from sending messages.

**Recommended fix:** Persist a block relationship, enforce server-side (RLS or Stream channel-member mute), read it back on mount.

---

### Finding P3-13 — "Clear Chat" (patient only) is a dead button
**Severity:** Low

**Root cause:** Confirm dialog's destructive action has an empty handler: `onPress: () => {}`. Also uses native `Alert.alert` instead of the app's `DawaAlert` design-system dialog used everywhere else on this screen — an inconsistency the codebase's own prior history explicitly flagged as something to avoid.

**Evidence:** `app/(patient)/chat-consultation.tsx:633-637`. Doctor's equivalent menu has no "Clear Chat" entry at all — asymmetric, half-implemented feature.

**Recommended fix:** Implement local-clear-from-view semantics, or remove the menu item.

---

### Finding P3-14 — No file-type/size validation on chat attachments
**Severity:** Medium

**Root cause:** `pickDocument()` uses `type: '*/*'`; neither chat screen calls the app's existing `validateFile()`/`ALLOWED_FILE_TYPES` (already defined in `lib/supabase.ts`, used elsewhere) before uploading to Stream.

**Evidence:** `app/(doctor)/chat-consultation.tsx:636-654`; `app/(patient)/chat-consultation.tsx:709-727`; `lib/supabase.ts:64-75` (unused for this path).

**Security impact:** Any file type (executables, scripts, archives) can be sent through a medical consultation channel — a malware-distribution vector, inconsistent with the allowlisting policy enforced elsewhere. No local size cap either.

**Recommended fix:** Reuse `validateFile()` (or a chat-specific allowlist) before upload; reject/cap oversized files client-side.

---

### Finding P3-15 — No app-level authorization check before watching a consultation's Stream channel
**Severity:** High, needs runtime/dashboard verification

**Root cause:** Both chat screens derive the Stream channel id directly from route params with no check that the signed-in user is actually `patient_id`/`doctor_id` on that consultation before calling `.watch()`. Protection currently relies on (1) Supabase RLS blocking the peer-identity lookup used for the membership self-heal — verified correct — and (2) Stream's own channel-type permission policy denying non-members — **not verifiable from this repo**, and the codebase's own history casts doubt: `freeze-consultation-channel`'s comments state a live test showed `frozen` alone did *not* reject `sendMessage` on this app's current channel-type policy set, requiring an explicit role-demotion workaround.

**Evidence:** `app/(doctor)/chat-consultation.tsx:334-366`; `app/(patient)/chat-consultation.tsx:411-447`; `supabase/functions/freeze-consultation-channel/index.ts:9-18` (the in-repo evidence of non-default policy behavior).

**Security impact:** If Stream's `messaging` channel-type policy is more permissive than assumed, a user who obtains another consultation's UUID (leaked log, deep link manipulation) could potentially read that channel's message history directly via the client SDK, bypassing the app's RLS (which only protects the metadata lookup, not the Stream channel itself).

**Recommended fix:** Add an explicit application-level authorization check (RPC/edge function verifying ownership) before/instead of the raw client-side `channel().watch()`, rather than relying entirely on Stream dashboard config that has already shown at least one non-default permission behavior in this app.

---

### Finding P3-16 — `freeze-consultation-channel`'s vault-secret dependency shares the same staleness risk as Finding P3-04
**Severity:** Medium-High, needs runtime verification

**Root cause:** `_call_freeze_consultation_channel()` (migration 038) reads a *different* vault secret (`carehub_service_role_key`, set manually out-of-band) to authenticate to `freeze-consultation-channel`. Migration 085's own comment explicitly notes this call path was "never part of" the July 18 outage *because* it was left on the platform-managed key — but that assumption only holds if that vault entry is kept in sync with the project's real service-role key going forward. Failure is silently swallowed (`RAISE WARNING` on missing secret; a live 403 from the fire-and-forget `net.http_post` surfaces nowhere).

**Evidence:** `supabase/migrations/038_freeze_channel_on_completion.sql:25-28`; `supabase/functions/freeze-consultation-channel/index.ts:94`; `085_internal_notification_secret.sql` (context).

**Security impact:** If this secret drifts, a completed consultation is marked `completed` and the UI hides the composer, but the Stream channel is never actually frozen server-side — nothing but client-side UI state prevents further messages via a modified client or direct API call using the still-valid Stream token.

**Recommended fix:** Add a reconciliation check (e.g., a periodic query for `status='completed'` consultations whose Stream channel isn't `frozen`) so a silent vault-key mismatch is caught within the same release cycle.

---

### Finding P3-17 — Chat self-heal watch logic duplicated instead of reusing the shared helper
**Severity:** Low (maintainability; no current functional divergence found)

**Evidence:** `lib/stream.ts:17-32` (`watchConsultationChannel()`) is correctly reused by all four call screens, but both chat-consultation screens re-implement the identical logic inline (`app/(doctor)/chat-consultation.tsx:351-366`; `app/(patient)/chat-consultation.tsx:432-447`).

**Recommended fix:** Replace inline blocks with calls to `watchConsultationChannel(...)`.

---

### Finding P3-18 — Chat screen unconditionally calls `stopWatching()` on unmount, un-watching a channel the Messages list still wants watched
**Severity:** Low-Medium

**Root cause:** `streamClient.channel('messaging', cid)` is a cached singleton per `cid` (verified via SDK source); `stopWatching()` doesn't reference-count callers. Both Messages tabs keep up to 30 channels actively watched via `useFocusEffect`; both chat-consultation screens unconditionally call `stopWatching()` on the same shared object at unmount.

**Evidence:** `app/(doctor)/chat-consultation.tsx:402`; `app/(patient)/chat-consultation.tsx:481`; `app/(doctor)/(tabs)/messages.tsx:79-83`.

**Why usually masked:** Returning to the Messages tab re-fires `queryChannels({watch:true})`; a `notification.message_new` listener also triggers a full re-query as a fallback, so no message is lost — it just arrives via a more expensive full-refetch path instead of the lightweight in-place update.

**Where not masked:** Reaching the chat screen via a different route (Home quick action, notification deep link) while Messages sits mounted-but-unfocused in the background — backing out still tears down the shared object, downgrading that row's live updates until Messages is refocused.

**Recommended fix:** Don't call `stopWatching()` from the chat screen at all, or reference-count watchers centrally (mirroring the existing "singleton over unique-channel-name" fix already applied elsewhere in this codebase).

### Areas verified as correct (Section 4)
- Clerk-ID vs. Supabase-UUID channel-membership bug (prior finding) confirmed fixed everywhere.
- `consultations` RLS correctly scopes the metadata lookup used for the self-heal membership array.
- Single Stream connection lifecycle (`useStreamConnection()` invoked once; `connectStream` disconnects any existing user first).
- SDK's built-in `recoverStateOnReconnect` plus the app's own redundant-but-harmless manual re-watch on `connection.changed`.
- Typing indicator/read-receipt/presence handling implemented consistently and symmetrically.
- Server-side chat lock (when it fires successfully) is genuine defense-in-depth: `frozen: true` + explicit read-only custom role.
- Channel-creation gating re-verifies `payment_status = 'paid'` and resolves Clerk ID via RLS-gated query.

### Areas requiring runtime/device verification
- Whether Stream's actual dashboard channel-type policy denies non-member access (Finding P3-15).
- Whether `carehub_service_role_key` currently matches the live `SUPABASE_SERVICE_ROLE_KEY` (Finding P3-16).
- Offline/failed-message UX in `stream-chat-expo`'s default composer (no offline queueing configured in this repo — needs a device test).
- Timing race between doctor "End" (client-immediate) and server-side freeze completing.
- Practical frequency of Finding P3-18's staleness window on a real device/session.

---

## SECTION 5 — Voice Consultation / SECTION 6 — Video Consultation

### Finding P3-19 — Agora token endpoint does not bind the requested `uid` to the caller's identity
**Severity:** Critical

**Root cause:** `supabase/functions/agora-token/index.ts` authorizes the caller against the *consultation* (patient/doctor/admin ownership) but never checks that the client-supplied `uid` corresponds to the caller's own identity before minting a token for it.

**Evidence:**
```
supabase/functions/agora-token/index.ts:71-73        // uid taken from request body, only checked for NaN
supabase/functions/agora-token/index.ts:150-157       // RtcTokenBuilder.buildTokenWithUid(..., uid, PUBLISHER, ...)
```
The counterpart's Clerk ID is already fetched by the client itself in every call screen (e.g. `app/(patient)/phone-consultation.native.tsx:763-768`), and `uidFromString()` (`lib/agora.ts:61-69`) is a pure, unsecreted djb2 hash of a Clerk ID — publicly computable by any client.

**Exploit path:** A legitimate participant in consultation X can read the counterpart's `clerk_id` via the same query the app already runs, compute `uidFromString(counterpartClerkId)` client-side, and request a token for *that* uid using their own valid bearer token. The endpoint happily mints a valid PUBLISHER token for the other party's own uid in the same channel.

**Files/Functions:** `supabase/functions/agora-token/index.ts`; `lib/agora.ts` (`uidFromString`, `fetchAgoraToken`). **DB tables:** `consultations`, `users`, `doctor_profiles`. **APIs:** Agora RTC token generation, `joinChannel`.

**Security impact:** Joining with the counterpart's uid causes Agora to treat it as a duplicate/kicked session (`onConnectionStateChanged` reason 19, already handled in both call screens for a legitimate multi-device case) — letting a malicious participant forcibly disconnect the other side of a live consultation. A targeted DoS against one's own call counterpart.

**Reproduction (conceptual):** As an authenticated patient on consultation X, fetch the doctor's `clerk_id` via the existing query, compute their uid client-side, POST to `agora-token` with that uid using the patient's own valid token — the function returns 200 with a usable token for the doctor's uid.

**Recommended fix (description only):** Stop trusting the client-supplied `uid` — have the edge function derive it itself from the caller's verified Clerk subject, or validate it against the role-appropriate uid pattern before minting.

---

### Finding P3-20 — Video call screens have no recovery path for a local Agora failure; doctor's video screen's rejoin effect has a stale dependency
**Severity:** High

**Root cause:** Both video screens gate "tap to retry" UI exclusively on `tokenFetchFailed`, never on `localError`/`callStatus === 'error'` — unlike both phone screens, which explicitly handle the general error case. Additionally, the doctor's video-engine effect depends on the derived boolean `agoraReady` rather than the raw `agoraToken` value; since `agoraReady` stays `true` across a token-retry refetch, React sees no dependency change and the effect never re-runs `joinChannel` even if a retry control existed.

**Evidence:**
```
app/(doctor)/video-consultation.native.tsx:932-944     // only tokenFetchFailed branch, final fallback always 'Connecting…'
app/(patient)/video-consultation.native.tsx:1150-1162   // same pattern
app/(doctor)/phone-consultation.native.tsx:970-978      // contrast: phone screens explicitly handle callStatus==='error'
app/(doctor)/video-consultation.native.tsx:748           // effect deps: [agoraReady, channelName, localUid] — stale
app/(patient)/video-consultation.native.tsx:904          // contrast: correctly depends on agoraToken directly
```

**Files/Functions:** Both video screens' Agora-engine `useEffect`, `onConnectionStateChanged`, `onError`, `connectionTimeoutRef`.

**User impact:** A doctor or patient whose device hits a genuine Agora join failure mid-video-consultation has no way to recover short of leaving/ending the call — worse than the equivalent phone flow. The stuck state is bounded (~10 min) by the heartbeat-driven stale-session cron reaping it as `ended_abnormally`, since the heartbeat gate turns off once `callStatus==='error'`.

**Recommended fix (description only):** Add a `callStatus === 'error'`/`localError` branch to both video screens mirroring the phone screens' retry row; change the doctor video screen's engine-effect dependency from `agoraReady` to `agoraToken`.

---

### Finding P3-21 — `agora-token`'s inactive-status gate uses a narrower terminal-status set than the client
**Severity:** Medium

**Root cause:** `INACTIVE_STATUSES` in the edge function omits `doctor_missed`, `missed`, and `call_declined`, which the client's own `TERMINAL_STATUSES` (`hooks/useConsultationState.ts:14-22`) already treats as terminal.

**Evidence:** `supabase/functions/agora-token/index.ts:20` vs. `hooks/useConsultationState.ts:14-22`.

**Security impact:** A stale/offline client can still mint a token and join a call the counterpart already considers over, producing a one-sided "connected" session with no one on the other end and consuming Agora minutes for a call that should be closed.

**Recommended fix:** Align `INACTIVE_STATUSES` with the client's terminal-status set.

---

### Finding P3-22 — No column-level guard on connection/reconnect milestone columns lets either party forge the other's connection state
**Severity:** Medium

**Root cause:** `consultations_update` RLS is `USING`-only (row ownership), with no `WITH CHECK`. Migrations 089/091/092 added targeted guards for financial columns and `status` only — the connection-milestone columns (`doctor_connected_at`, `patient_connected_at`, `doctor_reconnecting`, `patient_reconnecting`, `patient_left_at`, added in migrations 035/063/093) were never given an equivalent guard.

**Evidence:** `supabase/migrations/002_fix_rls_clerk_and_doctor_fk.sql:82-89` (no `with check`); `091_consultation_status_transition_guard.sql:60-62` (guards only `status`); `035_consultation_connected_at.sql:26-37` (auto-flips `status` to `in_progress` purely from these unguarded columns).

**Security impact:** Capped severity — this does not grant cross-consultation access, only lets a legitimate row-owner corrupt connection-state metadata for a call they're already part of (e.g., a patient setting `doctor_connected_at` to start the clock even though the doctor never actually joined; forging `patient_left_at`).

**Recommended fix:** Add a guard trigger (mirroring 089/091's pattern) restricting each milestone column to writes from the party it actually describes (service_role/cron/admin bypass as in existing guards).

---

### Finding P3-23 — Doctor's "Cancel outgoing call" doesn't update consultation status or notify the patient
**Severity:** Low

**Root cause:** The doctor's Cancel-Call action only tears down the local Agora session and navigates away — no status write, and mute/camera-off AsyncStorage keys for that consultation are never cleared.

**Evidence:** `app/(doctor)/phone-consultation.native.tsx:766-778`; `app/(doctor)/video-consultation.native.tsx:889-899`.

**User impact:** The patient's ring/waiting screen keeps ringing for up to the full 60s ring timeout even though the doctor already cancelled — self-resolving, but a needless UX gap.

**Recommended fix:** Have "Cancel Call" write a terminal status the patient's realtime subscription will react to immediately, and clear the persisted mute/camera keys.

### Areas verified as correct (Sections 5/6)
- Never-reset video error latch (prior bug) fixed — clears on peer join.
- `startPreview()` before `enableVideo()` ordering fix, with an explicit comment citing Agora's own docs.
- Self-view black/transparent-screen fix using `RtcTextureView` on Android (stronger than a zOrder tweak), documented rationale.
- Camera permission explicitly requested with audio-only fallback; microphone permission requested via `expo-av`.
- Camera-off state persistence via `lib/callCameraStorage.ts`, mirroring the existing mute-persistence pattern.
- Adaptive cloud-proxy fallback (only enabled after a genuine failure, avoiding needless relay latency).
- Token renewal (`onTokenPrivilegeWillExpire` + `renewToken`) correctly handling calls longer than the 1-hour token lifetime.
- Engine lifecycle/listener teardown — strict singleton, no duplicate-engine path found.
- Cross-device reconnect-state sync (migration 093) — local + peer-reported reconnect flags OR'd together.
- Doctor "End Consultation" always reachable — gated on DB-derived phase, not local-only call status.
- Background/foreground camera lifecycle correctly releases/reacquires the camera respecting the user's chosen state.
- Consultation status-transition guard (091/092) matches actual call-site behavior for the flows traced here.

### Areas requiring runtime/device verification
- Real network-loss timing/UX (grace periods, reconnect countdown) — needs physical device, not emulator.
- Camera/mic hardware behavior (front/back switch, low-end Android SurfaceView/TextureView compositing, speaker/earpiece routing).
- Killed-app/cold-launch recovery end-to-end (kill mid-call, relaunch, confirm rejoin + correct elapsed timer).
- Live confirmation the uid-impersonation exploit (P3-19) works against the actually-deployed function.
- Live repro of the video-screen retry bug (P3-20) — force a join failure and confirm no recovery path exists.
- Whether rapid navigation between call screens could overlap two Agora-engine effects in flight.

---

## SECTION 7 — Consultation Completion

### Finding P3-24 — Patient can silently overwrite the doctor's canonical PDF report; the paired DB write is itself RLS-blocked
**Severity:** Medium

**Root cause:** The `consultation-reports` storage bucket's INSERT/UPDATE policies authorize *either* party (patient OR doctor) to write to the same object path, with no role distinction. The patient app independently re-generates and re-uploads its own client-rendered PDF to that same path on every "Download as PDF" tap, silently replacing whatever the doctor generated. The patient's own attempt to record that path back into `consultation_summaries.report_pdf_path` is separately blocked by RLS (doctor-only column), so it silently no-ops.

**Evidence:** `supabase/migrations/034_consultation_reports_bucket.sql:27-51` (ownership-only policy, no role check); `app/(patient)/consultation-summary.tsx:467-480` (`persistReportToStorage`, no error check on the blocked update); `supabase/migrations/002_fix_rls_clerk_and_doctor_fk.sql:114-121` (`summaries_update` is doctor-only); `app/(doctor)/consultation-summary.tsx:407-416` (uploads to the identical path from the doctor side).

**User impact:** The doctor's authored report can be transparently replaced by a patient-rendered duplicate; if the patient generates a PDF before the doctor ever does, `report_pdf_path` never gets recorded and the doctor's own screen never shows a Download button despite a file existing in storage.

**Recommended fix (description only):** Restrict the bucket's insert/update policies to the doctor (+ admin/service-role); give the patient read-only access (already provided by the existing select policy). Patient's "Download as PDF" should fetch the doctor's already-generated report via signed URL rather than re-generating/re-uploading its own copy.

---

### Finding P3-25 — `consultation-reports` bucket has no file-size or MIME-type validation
**Severity:** Low-Medium

**Root cause:** Unlike `patient-documents`/`doctor-documents` (migration 026) and `profile-photos` (migration 099), this bucket's policies never got size/MIME CHECK constraints.

**Evidence:** `supabase/migrations/034_consultation_reports_bucket.sql:27-51` (no size/mimetype clause) vs. `026_storage_file_size_limits.sql`, `099_profile_photos_storage_validation.sql` (both have them).

**Security impact:** Any authenticated party to a consultation can bypass the app and PUT an arbitrarily large or non-PDF file directly to the storage REST endpoint — no cap exists.

**Recommended fix:** Add the same class of CHECK constraint used in migrations 026/099.

---

### Finding P3-26 — `consultation_summaries.consultation_id` uniqueness cannot be confirmed from migration history
**Severity:** Low / needs verification

**Root cause:** `lib/consultationCompletion.ts:33-44` upserts on `onConflict: 'consultation_id'`, which requires a UNIQUE constraint to function at all — but no `CREATE TABLE public.consultation_summaries` or corresponding UNIQUE statement appears anywhere in the tracked migrations, meaning the table was evidently created outside migration history.

**Evidence:** repo-wide grep across `supabase/migrations/*.sql` for `consultation_summaries` + `create table|unique|primary key` → no matches. `app/(doctor)/consultation-summary.tsx:262-274`'s manual (non-upsert) insert path could race a second insert if the constraint is genuinely absent.

**Recommended fix:** Confirm via live schema introspection that the UNIQUE constraint exists; if not, add it.

### Areas verified as correct (Section 7)
- Idempotent double-completion: upsert on conflict + DB-level no-op guard for same-value status writes.
- UI-level double-tap guards (`if (submitting) return`, disabled Save button).
- `EndConsultationSheet` validation requires non-empty chief complaint + diagnosis.
- Notification routing correctly distinguishes summary INSERT (`summary_ready`) vs. clinical-content UPDATE (`summary_updated`), excluding the PDF-path backfill from re-triggering a notification.

---

## SECTION 12 — Security (cross-cutting)

Beyond the items already listed above (P3-19 Agora uid binding, P3-15 Stream channel authorization, P3-22 connection-milestone column guards, P3-24/25 storage bucket role symmetry and validation), the following were specifically traced and verified correct:

- **Consultation status-transition guard** (migrations 091/092/097) is comprehensive — every (caller role, OLD→NEW) pair enumerated in the trigger was cross-checked against actual call sites (accept/decline, chat completion, payment-return/dev-bypass paid-transition) and all match; no gap found for the flows traced.
- **`agora-token` edge function** — verifies Clerk JWT via JWKS, requires ownership match (patient/doctor/admin) before minting, rejects issuance for terminal statuses (aside from the narrower-set gap in P3-21).
- **`generate-stream-token`** — mints a token only for the caller's own verified subject; no ownership check needed since a caller can only obtain a token for their own identity.
- **`freeze-consultation-channel`** — gated by exact-match service-role-key check, independently re-verifies `status === 'completed'` before acting (defense in depth) — aside from the vault-secret staleness risk in P3-16.
- **`consultation_summaries` RLS** — INSERT/UPDATE correctly scoped to the consultation's doctor only; SELECT to either party + admin.

---

## SECTION 13 — Performance (cross-cutting)

### Finding P3-27 — Unbounded, unpaginated consultation-list queries (doctor side)
**Severity:** Medium

**Root cause:** Both the doctor's Consultations tab and Consultation History screen fetch the doctor's entire consultation history with no `.limit()`; the tab screen re-runs this full fetch on every tab focus, realtime event, and app-foreground transition.

**Evidence:** `app/(doctor)/(tabs)/consultations.tsx:235-238, 296-299, 341-344`; `app/(doctor)/consultation-history.tsx:85-91`.

**Performance impact:** Growing query cost, payload size, and re-render cost over a doctor's lifetime on the platform, with no pagination ever engaged.

**Recommended fix:** Add `.limit()` with cursor/offset pagination, or patch only the changed row from realtime payloads instead of refetching the whole list.

---

### Finding P3-28 — Non-virtualized list rendering (doctor Consultations tab)
**Severity:** Low

**Evidence:** `app/(doctor)/(tabs)/consultations.tsx:456-544` uses `ScrollView` + `.map()` rather than `FlatList`, unlike `app/(patient)/(tabs)/appointments.tsx:810-836` which correctly uses `FlatList`.

**Recommended fix:** Replace with `FlatList`, matching the patient-side pattern.

---

### Finding P3-29 — Unfiltered `users`-table realtime subscription (systemic, pre-existing)
**Severity:** Low

**Root cause:** Both the doctor consultations tab and patient appointments hook subscribe to `UPDATE` on the entire `users`/`doctor_profiles` tables (Realtime can't filter by dynamic id lists), filtering client-side per event. Flagged for completeness — an existing, systemic pattern already present across multiple hooks, not a new regression.

**Evidence:** `app/(doctor)/(tabs)/consultations.tsx:303-321`; `hooks/usePatientAppointments.ts:236-259`.

---

### Finding P3-30 — Realtime channel not on the shared singleton manager (one of the known "stragglers")
**Severity:** Low

**Evidence:** `app/(doctor)/(tabs)/consultations.tsx:289` creates its channel directly (`Date.now()`-suffixed) rather than via `lib/realtimeChannelManager.ts`'s refcounted singleton, unlike `hooks/usePatientAppointments.ts` which correctly uses `subscribeRealtime`.

**Impact:** Lower risk than the historical bug class (properly scoped/cleaned-up effect), but inconsistent with the established pattern.

### Areas verified as correct (Section 13)
- `hooks/usePatientAppointments.ts` — proper singleton store, refcounted teardown with grace period, generation counters guarding stale async responses.
- `hooks/useNavGuard.ts` — generically protects any `guardNav()`-wrapped action against rapid re-entrant taps.

---

## SECTION 14 — Edge Cases

### Finding P3-31 — `EndConsultationSheet` submit button has no externally-supplied busy/disabled flag
**Severity:** Low / needs runtime verification

**Root cause:** The sheet's submit button is only `disabled={!isValid}`; it doesn't receive the parent's `submitting` state, so the only backstop against a true double-tap is the caller's `if (submitting) return` guard, which depends on a re-render committing between taps.

**Evidence:** `components/doctor/EndConsultationSheet.tsx:216-220`.

**Recommended fix:** Thread the parent's busy state into the sheet's button `disabled` prop for defense in depth.

### Areas verified as correct (Section 14)
- Doctor Accept double-tap / concurrent-device race — `navigatedRef` set synchronously pre-`await`; underlying write conditioned on current status; DB transition guard independently enforces the same, making a losing write safe.
- Doctor Complete double-tap — `if (submitting) return` guard; underlying writes idempotent regardless.
- Expired Agora token re-mint re-checks authorization on every request (narrow scope — full reconnect/refresh UX is a voice/video-audit topic, see P3-20).

---

## Cross-cutting notes

- **P3-04 (notification vault-secret regression) and P3-16 (freeze-channel vault-secret risk)** are the same architectural failure mode — a DB trigger authenticating to an edge function via a vault-cached secret that can silently drift from the value the function actually checks — occurring in two different code paths. Worth fixing as one class of problem (see recommended implementation order item 6) rather than two unrelated bugs.
- **P3-15 (Stream channel authorization)** and **P3-16 (freeze-channel vault secret)** both stem from trusting Stream Chat's platform-level configuration/access-control for guarantees the app's own code doesn't independently enforce — the freeze-function's own historical comment is direct evidence that this specific app's channel-type policy set has already behaved unexpectedly once.

# Dawa Mobile — Phase 4 Scheduled Consultation System, Scheduling Engine &amp; Security Audit (READ-ONLY)

**Date:** 2026-07-30
**Scope:** Mobile app only (Android/iOS, Expo/React Native). `carehub-web` referenced only where it shares a code path with mobile (e.g. the admin cancel endpoint mobile cancellation ultimately funnels into). Scheduled (non-on-demand) consultations are the primary focus; on-demand logic is covered where it shares guards with scheduling.
**Method:** Static, read-only source audit across 7 parallel agents, each tracing full execution paths (Postgres migrations/RPCs/triggers/RLS, Edge Functions, Realtime subscriptions, cron jobs, client screens/hooks). No code was modified, no commits made, no migrations created, nothing deployed.
**Status:** No code changes made. This document is the deliverable for Phase 4.

---

## EXECUTIVE SUMMARY

Phase 4 traced the entire scheduling system — doctor availability → slot generation → booking → payment → slot locking → reminders → waiting-room/doctor activation → consultation → rescheduling → cancellation — plus the RLS/RPC security layer and database integrity underneath all of it, across seven parallel read-only audits. **32 distinct issues** were found after deduplicating overlapping findings that multiple independent agents converged on (a meaningful signal in itself — see below), including **2 Critical** and **5 High** severity items.

The single most severe finding is a **missing `WITH CHECK` clause on the `consultations` table's UPDATE RLS policy** (unchanged since the app's earliest migrations). Because Postgres RLS only re-validates `USING` against the pre-update row, any authenticated patient or doctor who legitimately owns a consultation row can rewrite `patient_id`, `doctor_id`, `type`, `scheduled_at`, or `waiting_started_at` to **any value**, via a direct PostgREST call — no app UI needed. This single gap produces five separate concrete exploits: cross-tenant chat/PHI leakage, fabricated-appointment injection into a stranger's account, per-consultation-type price fraud, on-demand queue-jumping, and a complete bypass of every booking-integrity check (day-off, working-hours, doctor-busy) that only exists inside the booking RPCs, not as a table-level constraint. Two other agents (time-handling and database-integrity) independently rediscovered pieces of this same root cause from different angles — the client legitimately writing `waiting_started_at` directly instead of through a guarded RPC, and the total absence of a real overlap/range constraint on the schedule — without knowing about each other's work, which is strong corroboration this is real and not a static-analysis false positive.

The second Critical finding is financial: cancelling a **paid, future** ("`scheduled`") consultation — the *only* functioning cancellation path for that state, since neither the mobile nor web app expose a cancel button for it, only Reschedule — silently forfeits the patient's payment. The credit-issuance trigger's status list was never updated when the `'scheduled'` status was introduced, and refunds are a deliberate, documented no-op in this app's design (credit is the sole compensation mechanism). This is not a hypothetical: it fires on ordinary, legitimate admin use of the one cancel affordance that exists.

Beyond these two, the audit surfaced a **recurring architectural pattern**: several independent subsystems (doctor-activation pushes, 30/10/5-minute reminder tiers, the credit-application flow) use a "check now, mark done later" guard instead of an atomic claim, creating narrow TOCTOU windows for duplicate notifications or duplicate credit consumption under latency or retry. This same class of bug was flagged independently by three different agents in three different subsystems — again, convergent evidence rather than one agent's guess. The good news: the system's *hard* correctness backstops (slot-lock TTL lifecycle, financial-column tamper guards, patient/doctor-busy enforcement, webhook idempotency, status-transition whitelisting, Ethiopia-timezone-anchored time math) are, on the whole, well-built and were extensively verified correct — the failures cluster specifically around what happens at the *edges* of the happy path: abandoned flows, late webhooks, cold-relaunches, and rows in transient states that predate a later migration's protections.

### Total issues by severity

| Severity | Count |
|---|---|
| Critical | 2 |
| High | 5 |
| Medium | 16 |
| Low | 9 |
| **Total** | **32** |

(A few findings carry a hybrid rating — e.g. "Medium-High" — reflecting genuine cross-agent disagreement on severity, usually because reachability through the shipped UI is blocked but reachability via direct API calls is not. Each is counted once, in its higher band, above.)

---

## TOP 10 RELEASE BLOCKERS (ranked by real-world impact)

1. **[CRITICAL] `consultations_update` RLS has no `WITH CHECK`** — any patient or doctor can rewrite `patient_id`/`doctor_id`/`type`/`scheduled_at`/`waiting_started_at` on their own row to arbitrary values via a direct API call, enabling cross-tenant PHI leakage, fabricated-appointment injection, price fraud, and queue-jumping. (§17)
2. **[CRITICAL] Cancelling a paid, future ("`scheduled`") consultation forfeits the patient's payment** — the credit trigger's status list omits `'scheduled'`, and it's the only cancellation path that state actually has. (§7/§9)
3. **[HIGH] Double consultation-credit consumption via abandon-and-rebook** — a patient can attach the same unused credit to two separate bookings before either is paid, discounting both at Chapa's expense. (§19)
4. **[HIGH] `slot_locks` INSERT policy is `WITH CHECK (true)`** — any authenticated user can lock any doctor's future slots for free, indefinitely, with zero ownership relationship, griefing that doctor's entire bookable calendar. (§5/§17)
5. **[HIGH] Cold app-relaunch mid-payment can auto-cancel a booking whose Chapa payment actually succeeded**, showing the patient a false "no charge made" message; the webhook later silently resurrects the row, risking two paid active consultations if the patient rebooks in the interim. (§19/§20)
6. **[HIGH] `chapa-webhook`'s late-payment "resurrect" fallback silently swallows a unique-constraint failure** — if the real payment confirmation arrives after the 30-minute stale-sweep already cancelled the row *and* another patient retook the slot, the patient is charged and permanently stuck at `cancelled` with no notification and no recovery path. (§19)
7. **[HIGH] No server-side grid-alignment/overlap enforcement on booking** — `book_appointment_slot()`/`reschedule_appointment_slot()` only block *exact-timestamp* collisions; a direct RPC call with an off-grid start time or non-standard duration can create genuinely overlapping "scheduled" consultations for one doctor. Not reachable through the shipped UI, but a real gap between client convention and server invariant. (§2/§17/§18)
8. **[MEDIUM-HIGH] Non-atomic "mark as sent" guards across notification/reminder cron paths** create TOCTOU windows for duplicate doctor-alert pushes and duplicate 30/10/5-minute reminders under edge-function latency — found independently by two separate agents auditing different subsystems. (§12/§13/§14)
9. **[MEDIUM] Booked-slot highlighting in Booking/Reschedule sheets reads the device's local clock instead of Ethiopia time**, unlike every other slot-availability calculation in the same files — a diaspora/traveling patient can see a free slot marked "Booked" (or vice versa), leading to a confusing `SLOT_TAKEN` failure on an otherwise-correct-looking selection. (§2/§3)
10. **[MEDIUM] Doctor's app-wide "active consultation" recovery banner has no realtime push** — only an `AppState`-foreground re-check — asymmetric with the patient-side equivalent, which was explicitly hardened with a realtime subscription for exactly this reason. A doctor sitting on a non-Home/Consultations tab when a queued consultation auto-activates may not see the banner until they background/foreground the app. (§10/§15)

---

## CRITICAL ISSUES

### C1 — `consultations_update` RLS policy has no `WITH CHECK` clause

**Root cause:** `supabase/migrations/002_fix_rls_clerk_and_doctor_fk.sql:82-89` defines:
```sql
create policy consultations_update on public.consultations
  for update to authenticated
  using (
    patient_id = public.get_user_id_from_jwt_sub()
    or doctor_id = public.get_doctor_profile_id()
    or public.is_admin()
  );
```
No `WITH CHECK`. Postgres RLS only re-validates `USING` against the pre-update row — once ownership is established, the caller may set every column to any value. This policy has never been redefined since migration 002; only two narrow trigger patches were later bolted on:
- `089_security_hardening.sql` (`guard_consultation_financial_columns`) blocks only `payment_status, patient_amount, doctor_amount, platform_amount, credit_used, credit_source_id, chapa_tx_ref, consultation_credit, credit_amount, replacement_consultation_id`.
- `097_allow_paid_pending_payment_transition.sql` (`guard_consultation_status_transitions`) blocks only `status`, via a role/transition whitelist.

Every other column — **`patient_id`, `doctor_id`, `scheduled_at`, `type`, `is_on_demand`, `waiting_started_at`, `patient_connected_at`, `patient_left_at`, `previous_scheduled_at`, `notification_sent`, `reminder_*_sent`** — is entirely unrestricted for any caller who owns the row. Notably, migration `094_guard_review_immutable_columns.sql` line 9 explicitly (and incorrectly) claims *"Every other sensitive table (consultations, doctor_profiles) already got an equivalent BEFORE UPDATE guard"* — false for these columns.

**Concrete exploits (all statically confirmed):**
- **(a) Cross-tenant PHI/chat leak via `doctor_id` reassignment.** `doctor_profiles.id` is enumerable by any authenticated user via `doctor_profiles_select`. A patient can `PATCH` their own consultation's `doctor_id` to an arbitrary approved doctor's profile id; `messages_select`/`summaries_select` re-evaluate `c.doctor_id = get_doctor_profile_id()` dynamically, so the reassigned doctor instantly gains read access to that consultation's chat history and clinical summary, and the row appears in their own consultation list.
- **(b) Fabricated-appointment injection via `patient_id` reassignment.** `reviews_select` (`003_security_policies.sql:67-70`) is `for select using (true)` with no `to authenticated` clause, publicly leaking `patient_id`. A caller can `PATCH` `patient_id` to a victim's `users.id`, injecting a fabricated appointment/history row into an account that never booked it.
- **(c) `scheduled_at` tampering bypasses every booking-integrity check.** Day-off/blocked-date/working-hours validation and doctor-busy/scheduled-soon buffers exist only inside `book_appointment_slot()`/`reschedule_appointment_slot()`, never as a table trigger. A direct `PATCH {"scheduled_at": "..."}` on an owned row skips all of them; the only remaining guard is the exact-timestamp unique index (see H4/§17 Integrity-1).
- **(d) Revenue bypass via `type` tampering.** `patient_amount` is guarded, `type` is not — a patient can pay the chat rate, then `PATCH {"type":"video"}` post-payment to receive a pricier consultation type for free.
- **(e) Waiting-queue jump via `waiting_started_at` tampering.** `app/(doctor)/(tabs)/home.tsx:313-319` sorts a doctor's live queue strictly by `waiting_started_at` ascending; a patient can backdate their own row to `2020-01-01` and jump every genuinely-earlier-waiting patient. Independently corroborated by the time-handling agent, who found the mobile client itself legitimately writes this column client-side on on-demand payment confirmation (`app/(patient)/payment-return.tsx:304-317`, device clock, no server derivation) — a second, non-malicious reason this column needed a guard.

**Affected:** `consultations` table RLS, `messages_select`/`summaries_select` policies, `reviews_select` (contributing leak), `app/(doctor)/(tabs)/home.tsx` queue ordering.

**Recommended fix (describe only):** Add a `BEFORE UPDATE` guard trigger (mirroring the pattern already established in migrations 089/094/098) blocking non-admin/non-service-role changes to `patient_id`, `doctor_id`, `type`; gate `scheduled_at`/`waiting_started_at` changes to only the legitimate code paths that need them (service-role cron, or re-invoke `_validate_scheduled_slot`/ownership checks inline). Independently, add `to authenticated` and a real ownership check to `reviews_select` to close the `patient_id`-enumeration side-channel that makes exploit (b) practical.

---

### C2 — Cancelling a paid, future ("`scheduled`") consultation forfeits the patient's payment

**Root cause:** `set_consultation_credit_on_decline()` (current version: `supabase/migrations/062_remove_waiting_room_timeouts_and_busy_gap.sql:48-67`) only issues a `consultation_credit` when:
```sql
NEW.status = 'declined'
OR (NEW.status = 'cancelled' AND OLD.status IN ('pending_payment', 'waiting_for_doctor'))
```
`'scheduled'` — introduced by migration 041 to represent a **paid**, future, not-yet-activated booking, payment-wise identical to `'waiting_for_doctor'` — was never added to this list, in migration 041 or any of the ~20 migrations since. Refunds are structurally impossible as a fallback: `supabase/functions/handle-refund/index.ts` is an explicit no-op stub ("Refunds are DISABLED in V1"), and its trigger was actually dropped in migration 018. Consultation credit is the *only* compensation mechanism in the entire system.

**Reachability (verified, not hypothetical):**
- Neither mobile (`app/(patient)/(tabs)/appointments.tsx`'s `UpcomingCard`) nor web (`carehub-web/app/patient/appointments/page.tsx`) offer a Cancel action for `status='scheduled'` — only Reschedule.
- The DB status-transition guard itself doesn't permit a patient to self-cancel from `'scheduled'` at all (only from `pending_payment`/`waiting_for_doctor`).
- The **only** functioning cancellation path for a `'scheduled'` row is the admin panel (`carehub-web/app/api/admin/consultations/[id]/route.ts:41-57`), which uses the service-role client (bypassing the transition guard) and unconditionally flips status to `cancelled` for any non-terminal row. For an `OLD.status='scheduled'` row, this write is silently exempt from the credit trigger's `IN (...)` list — `consultation_credit` stays `false`, `credit_amount` stays `0`.
- The patient notification sent for this event says only *"...cancelled by an administrator. Please contact support."* — no mention of credit or refund either way, so the loss is invisible until the patient investigates independently.

**User Impact:** A patient who paid for a future appointment and needs to cancel (illness, conflict, wrong doctor) must contact support; support cancels via the only tool available; the patient's payment disappears with no credit and no refund, and nobody involved — patient or admin — is told this is happening.

**Related finding (§7/§9, HIGH):** There is *also* no patient-facing cancel button for `'scheduled'` state at all (only Reschedule) — this is the functional root cause that funnels every legitimate cancellation request into the broken admin path above. Fixing C2's trigger without also adding a real patient-facing cancel flow (with its own transition-guard entry) still leaves patients dependent on support to exercise their money-safe cancellation.

**Recommended fix (describe only):** Add `'scheduled'` to `set_consultation_credit_on_decline()`'s `OLD.status IN (...)` list. Separately, add a genuine "Cancel Appointment" action to the patient UI for `status='scheduled'`, with a matching entry in the transition-guard's patient allow-list.

---

## HIGH ISSUES

### H1 — Double consultation-credit consumption via partial-credit abandon-and-rebook (TOCTOU)

Credit eligibility is *checked* (`credit_used = false`) independently in `apply-credit` (reservation) and `initialize-payment` (discount calculation), but only actually *claimed* (`credit_used = true`) much later, at payment settlement, via migration 088's trigger. The **full-coverage** branch of `apply-credit` correctly claims atomically (`UPDATE ... WHERE credit_used = false`, verified correct). The **partial-coverage** branch (`apply-credit/index.ts:234-259`) does not — it only sets `replacement_consultation_id`, never `credit_used`. `BookingModal.tsx:289-331` re-queries "most recent unused credit" every time the modal opens, so a patient who starts a partial-credit booking, abandons it before paying (network drop, app kill, or simply changing their mind — all in-scope scenarios), then opens booking again for a *different* doctor, sees the same unused credit offered again and can attach it to a second booking. If both bookings are later paid to completion, Chapa collects the discounted amount on **both**, even though the credit can only "settle" (flip `credit_used`) once. Reachable via ordinary abandon-and-rebook behavior, no malicious intent required.

**Recommended fix:** Claim the credit exclusively at reservation time in the partial branch too (atomic `UPDATE ... WHERE credit_used = false`, mirroring the full-coverage branch), with a reservation TTL + release cron symmetrical to `slot_locks`' own TTL pattern.

### H2 — `slot_locks` INSERT RLS policy is fully open

`supabase/migrations/019_appointment_slot_locking.sql:42-44`:
```sql
CREATE POLICY "Authenticated users can acquire slot locks"
  ON public.slot_locks FOR INSERT WITH CHECK (true);
```
Never revised — migration 089 dropped the equally-unnecessary client-facing UPDATE policy with the reasoning "no client code calls this directly," but the identical reasoning was never applied to INSERT (client bookings always go through the SECURITY DEFINER RPCs, never direct table INSERTs). `consultation_id` is nullable. Any authenticated user can `INSERT` a `slot_locks` row for any doctor's any future slot; the `UNIQUE(doctor_id, slot_start)` constraint then makes that slot unbookable via the real booking RPC (`SLOT_TAKEN`) until the row's 10-minute TTL expires — and since the UPDATE policy is gone, it can't even be extended, but it can be trivially re-inserted in a loop to sustain an indefinite, zero-cost block of a target doctor's entire calendar.

**Recommended fix:** Drop the open client-facing INSERT policy — no legitimate call site needs it, since booking always goes through the SECURITY DEFINER RPCs which use the service-role/definer context to write the lock themselves.

### H3 — Cold app-relaunch mid-payment can auto-cancel a booking whose payment actually succeeded

`lib/pendingPayment.ts`'s stored `PendingPayment` object carries no payment-status field. On a killed-and-relaunched app, `app/(auth)/splash.tsx:88-106` restores straight into `payment-return.tsx` with `paramChapaStatus=undefined`, resolving `initialChapaStatus` to `'unknown'`. After the 90-second poll window fails to observe `payment_status='paid'`, any value other than `'success'` — including `'unknown'` — falls into the branch that calls `cancelConsultationById()` and shows "Payment Failed — No charge has been made," which may be false: the real Chapa payment can simply be delayed past 90 seconds (webhook lag is explicitly anticipated elsewhere in the same file). `chapa-webhook`'s "recoverable row" fallback will later resurrect this specific row from `cancelled` back to `scheduled`/`waiting_for_doctor` once the real webhook lands (mitigating factor — the row isn't permanently lost) — but in the interim the patient, told falsely that nothing was charged, may re-book and pay again, risking **two paid, active consultations from one payment intent**.

**Recommended fix:** Persist the last-known Chapa status across app kills, or — simpler — never auto-cancel from the cold-relaunch path; always land on the "still processing" screen with a manual recheck action, matching what already exists for `initialChapaStatus==='success'`.

### H4 — `chapa-webhook`'s late-payment "resurrect" fallback silently swallows a unique-violation

Timeline: `slot_locks` TTL sweeps at 10 minutes, but the consultation row itself only auto-cancels at 30 minutes (`cancel_stale_pending_payments()`, migration 061). Between minute 10–30, `uq_consultations_doctor_slot` (which does **not** exclude `pending_payment`) still blocks a second patient from taking the identical slot — no double-booking there. **After** minute 30, the row is `cancelled` (now excluded from that index), so a second patient can freely rebook the same slot and pay. If the *first* patient's Chapa webhook then lands late — a scenario `chapa-webhook/index.ts:196-231`'s own comments acknowledge and attempt to handle — it unconditionally flips their `payment_status` to `'paid'`, then tries to resurrect their row to `scheduled`/`waiting_for_doctor` (lines 232-262). If the second patient already occupies that slot, this UPDATE collides with the unique index and throws — but the whole block is wrapped in a bare `try { ... } catch (err) { console.error(...) }` (lines 232, 263-265), silently swallowing it. **Net result:** the first patient is charged (`payment_status='paid'`) but permanently stuck at `status='cancelled'` — no notification, no refund trigger, no waiting room — precisely the "money captured, nothing happens" failure mode the surrounding code claims to close, except specifically for the case where the slot was retaken before the late webhook arrived.

**Recommended fix:** Detect the unique-violation specifically in this catch block and either trigger the existing credit-issuance path or flag the row for manual reconciliation, instead of a bare `console.error`.

### H5 — No server-side grid-alignment or overlap enforcement on scheduled bookings

`_validate_scheduled_slot()` (migration 054, current and unchanged since) validates only day-off/blocked-date/working-hours bounds — never that `p_slot_start` lands on the doctor's actual 20-minute grid, and `p_slot_duration` is a caller-supplied integer with a `DEFAULT 20` but no enforced/allowed-values check. The only DB-level anti-collision protections (`slot_locks UNIQUE(doctor_id, slot_start)`, `uq_consultations_doctor_slot UNIQUE(doctor_id, scheduled_at)`) are both **exact-timestamp equality**, not a `tstzrange`/`EXCLUDE USING gist` range constraint. The shipped app UI only ever requests grid-aligned slots, so this is unreachable through normal use — but a direct RPC call with an off-grid start time (e.g. 10:05) and/or a short duration (e.g. 5 minutes) can insert multiple genuinely time-overlapping "scheduled" consultations for one doctor without colliding on either unique constraint. Independently flagged by three agents (architecture, database-integrity, time-handling) from three different angles, converging on the same gap.

**Recommended fix:** Reject any `p_slot_start` not aligned to the doctor's configured grid, and any `p_slot_duration` not equal to the platform's fixed slot length, inside `_validate_scheduled_slot()`; or replace the exact-timestamp unique indexes with a real range-exclusion constraint.

---

## MEDIUM ISSUES

**M1 — Non-atomic "mark as sent" TOCTOU across notification/reminder cron paths (§12/§13/§14).** Two independent agents found the same architectural pattern in different subsystems: `trigger_appointment_notifications()`/`_call_consultation_notification()` (doctor "new request" alert) and `trigger_appointment_reminders()` (30/10/5-minute tiers) each only *check* `notification_sent`/`reminder_*_sent = false` in SQL, but the flag is only flipped `true` later, inside the downstream edge function, *after* the push has already been dispatched. Because pg_cron ticks on a fixed one-minute cadence independent of when a row actually became eligible, and the reminder tiers' "catch-up margin" (migration 074) deliberately makes a row eligible across up to 3 consecutive ticks, any edge-function latency spike (cold start, FCM/APNs slowness, a queued `pg_net` backlog) can cause the same row to be re-selected and re-notified before the first dispatch's flag write lands. Not a missed-notification risk (fail-open by design) — a duplicate-notification risk. **Fix:** claim atomically in SQL (`UPDATE ... WHERE flag = false RETURNING id`) before dispatching, not after.

**M2 — Booked-slot display in Booking/Reschedule sheets uses device-local time, not Ethiopia time (§2/§3).** Every other slot-availability calculation in `lib/slotGeneration.ts` and the server's `_validate_scheduled_slot` is deliberately anchored to `Africa/Addis_Ababa` wall-clock time independent of device timezone (explicitly documented, sound design). The one place that queries and labels *already-booked* times — `BookingModal.tsx:213-236` and `RescheduleModal.tsx:134-154` — instead builds its day-range query and re-labels rows using `new Date("...T00:00:00")` (parsed device-local) and `d.getHours()/getMinutes()` (device-local components). For a patient whose device timezone isn't Ethiopia's, a free slot can render "Booked" (blocking a valid choice) or a taken slot can render "Available" (leading to a confusing `SLOT_TAKEN` failure at payment time). No actual double-booking risk — the booking RPCs themselves are correctly Ethiopia-anchored — purely a display bug, but a confusing one for exactly the diaspora/traveler users the rest of the codebase explicitly designed around.

**M3 — Doctor's global "active consultation" banner has no realtime push (§10/§15).** The patient-side equivalent in `app/_layout.tsx` explicitly pairs its `AppState`-foreground recovery check with a realtime subscription, with a code comment specifically justifying why ("a patient sitting idle on a foregrounded screen... is otherwise never pulled in until they background/foreground"). The doctor-side `recoverDoctor()` effect has no such subscription — only foreground `AppState` triggers and initial mount. A doctor foregrounded on a tab other than Home/Consultations when one of their consultations transitions to `accepted`/`in_progress` (e.g. via a queued auto-activation freeing up) may not see the global banner until backgrounding/foregrounding. Narrower than it first appears, since Home and Consultations tabs each have their own independent realtime listeners that would still surface the change locally on those specific screens.

**M4 — `apply-credit`/reminder near-term reschedule can skip pre-start reminders (§8/§12).** `reschedule_appointment_slot()` correctly resets all `reminder_*_sent` flags on reschedule, but the 5-minute tier's staleness check (`scheduled_at - created_at < 10 minutes`) compares against the row's **original** booking time, not the reschedule time — a patient who booked days ahead and reschedules to 5 minutes out will never satisfy it. The 30/10-minute tiers similarly only fire within fixed cron-tick windows that a near-term reschedule can land inside of already. Unlike the `'scheduled_booking'` handler (which explicitly detects `minutesUntilStart < 10` at booking time and fires an immediate "starting soon" push), the `'rescheduled'` handler has no equivalent branch. The exact-time "starting now" push still fires correctly (no appointment is silently missed) — this is a reduced-lead-time UX gap, not a data-loss bug.

**M5 — `slot_locks` TTL/cleanup lag produces a misleading "still available" UI window (§5/§19).** Between a slot's booking and the `slot_locks` cleanup cron's next run (up to ~10-20 minutes), a still-genuinely-held slot can display as "Available" since the client only reads `slot_locks`, not `consultations`. No actual double-booking occurs — `uq_consultations_doctor_slot` catches it at the DB level — but the resulting `INSERT INTO consultations` in `book_appointment_slot()` isn't wrapped in the same `unique_violation` handler its sibling `slot_locks` insert has, so the failed second booking surfaces as a raw Postgres constraint error instead of a friendly `SLOT_TAKEN` message.

**M6 — `dev-payment-bypass`'s entire production safety boundary is a single Supabase secret (§19/§20, config-dependent).** The endpoint's server-side gate is exactly one check: `Deno.env.get('DEV_PAYMENT_BYPASS_ENABLED') !== 'true'`. Everything else about it (Clerk JWT verification, ownership check, `pending_payment` status check, `chapa_tx_ref` deliberately left null so the refund trigger can't fire) is correctly implemented. A second, independent agent additionally verified the client-side gating (`__DEV__` compiled out of release bundles, `.env` git-ignored and absent from every EAS build profile) is solid, meaningfully reducing real-world risk — but the fundamental point stands: if that one secret is ever set `true` in the production Supabase project, any authenticated patient can mark any of their own bookings paid via a direct HTTP call, bypassing Chapa entirely. Recommend a second, static in-code guard (e.g. reject if the project's own `SUPABASE_URL` matches a known-production ref) as defense in depth.

**M7 — No server-side range/overlap check beyond the exact-timestamp unique index (§17/§18, DB integrity framing of H5).** Same underlying gap as H5, listed here from the pure database-integrity angle: no `EXCLUDE USING gist` constraint exists anywhere on `consultations` for doctor-scheduling ranges.

**M8 — `usePatientAppointments.ts` fetches a patient's entire consultation history with no `.limit()` (§21).** Unlike the doctor-side consultations screen, which already caps at 200 rows with a documented rationale for the exact same anti-pattern, the patient-side hook's `refresh()` — which also re-runs on every realtime event for that patient — has no cap at all. No functional bug today; grows unbounded with a long-time patient's total historical consultation count.

**M9 — `BookingModal.tsx`'s `slot_locks` realtime channel still uses a `Date.now()`-suffixed topic with no `getChannels()` staleness guard (§15).** The project has fixed this exact bug pattern (unique-per-mount channel names causing overlapping stale subscriptions) at least five times elsewhere, including in this same file's sibling `RescheduleModal.tsx`, which was explicitly hardened against it with a comment referencing "the recurring stale-channel race." `BookingModal.tsx`'s channel — and `RescheduleModal.tsx`'s own *doctor-availability* channel, a separate subscription in the same file — never got the same treatment. Effect deps include `selectedDayValue`, which changes on every day-chip tap, so this channel tears down and recreates on every tap; during the brief async teardown window, two live subscriptions can transiently coexist, causing redundant (not incorrect) re-fetches.

**M10 — Doctor's `app/(doctor)/(tabs)/schedule.tsx` uses two raw `Date.now()`-suffixed realtime channels, unmigrated to the shared manager (§15).** Same bug class as M9, on the core doctor scheduling screen itself. Lower practical risk since `profileId` (the only effect dependency) rarely changes mid-session and this tab tends to stay mounted across tab switches — but it's a straggler on a screen the audit's own scope centers on.

**M11 — `slot_locks` INSERT-open + no overlap enforcement combine into a "verified correct" gap worth flagging together: even legitimate simultaneous double-booking attempts are only caught, not prevented, at commit time (§5/§6).** Both agents independently confirmed the *protections that exist* (exact-timestamp unique constraints) work correctly for their intended purpose; this entry exists to flag that "correctly catches at insert-time" and "prevents ahead of time" are different guarantees, and the UI/UX consequences of the former (M2, M5) are real even though no actual double-booking data-integrity failure was found anywhere in this audit.

**M12 — Doctor Schedule screen's "Upcoming Appointments" list silently caps at 20 rows with no pagination affordance or indicator (§21).** `book_appointment_slot()` has no such cap — a 21st+ future appointment is genuinely booked and will still fire its own reminders/notifications on schedule — the doctor simply cannot see it on this screen (no "+N more") until earlier ones clear. Plausible for a popular doctor with many scheduled bookings weeks out.

**M13 — `usePatientDoctors.ts` fetches the entire approved-doctor directory with no pagination (§22).** Backs both Home's featured widgets and the full Doctors tab list; fine at current doctor counts, will degrade as the directory grows into the hundreds/thousands with no server-side pagination or filtering.

**M14 — Fail-open time parsing in `_parse_time_to_minutes()` (§17/§18).** Returns `NULL` on unparseable working-hours JSON rather than raising; `_validate_scheduled_slot()` only enforces the working-hours window when both bounds parse successfully — malformed doctor availability data silently *disables* hours enforcement for that day instead of rejecting the booking. Self-inflicted (only affects the doctor whose own data is malformed), but should fail closed.

**M15 — No doctor self-service cancellation of an already-accepted consultation (§9).** `guard_consultation_status_transitions()` grants doctors no `cancelled` target from any status. If a doctor accepts a scheduled appointment and then has a genuine conflict before it starts, their only recourse is asking an admin — which routes through the same broken credit path as C2 if the underlying `set_consultation_credit_on_decline()` fix doesn't also cover `accepted`. Appears to be an intentional product gap (never present across 103 migrations) rather than a regression — flagged for product awareness.

**M16 — `doctor_profiles_update` RLS also has no `WITH CHECK` on `user_id` (§17).** Same missing-clause pattern as C1, but scoped: a doctor can only self-lockout by reassigning their own row's `user_id` (no path found to hijack another doctor's row, since `USING` still requires ownership of the OLD row). Flagged for consistency, not independently exploitable against a victim.

---

## LOW ISSUES

**L1 — `slot_locks` rows for confirmed appointments are never pruned (§21/§22, capacity-planning only).** Migration 075's trigger sets `expires_at='infinity'` on confirmation; the only cleanup cron only deletes `expires_at < now()`, which never matches. Table grows by roughly one permanent row per ever-confirmed consultation, for the platform's lifetime, with no archival job. Not an active performance problem today (the relevant unique index keeps day/doctor-scoped reads fast regardless of table size) — flagged for future capacity planning.

**L2 — `trigger_doctor_repeat_notifications()` has no `FOR UPDATE SKIP LOCKED`/overlap guard (§14).** This specific 3-minute repeat-notify cron updates its own claim column synchronously (unlike M1's async pattern), so it's lower-risk than M1 — but if a previous run is still executing when the next tick fires (large backlog, slow DB), two overlapping executions could theoretically select the same row before either claims it.

**L3 — `chapa-webhook` accepts unauthenticated calls and probes Chapa's verify API with no rate limit of its own (§19).** Not exploitable for state mutation (the actual `payment_status='paid'` write only happens if Chapa's own verify endpoint independently confirms success for that exact `tx_ref`) — minor info-disclosure/cost-nuisance surface only.

**L4 — Stale, inaccurate comment in `useDoctorOnlineToggle.ts` describes a nonexistent "app-level background handler" that auto-flips `is_online` false (§15, documentation hazard only).** No such mechanism exists anywhere in the current codebase — migration 060 deliberately removed every auto-offline mechanism as a documented product decision, and `useDoctorPresenceHeartbeat.ts`'s own comment correctly reflects this. The stale comment in the sibling file could mislead a future engineer into reintroducing logic the team explicitly rejected. No behavioral bug.

**L5 through L9 — minor/informational items rolled up from the per-section reports:** (L5) `reviews_select`'s public `patient_id` exposure is itself worth an independent RLS tightening pass beyond its role enabling C1(b). (L6) No live confirmation was possible that `pg_cron` disallows overlapping runs of the same job name — the theoretical basis for L2/M1's worst case. (L7) `patientDoctors`/`patientAppointments` hooks (M8/M13) share a "no `.limit()`" pattern that's worth fixing as one class of change alongside the doctor-side precedent that already exists. (L8) The admin cancellation endpoint (`carehub-web/app/api/admin/consultations/[id]/route.ts`) was the only admin-facing cancel surface found via grep, but an exhaustive review of every admin page for an alternate direct-write path was out of scope for this pass. (L9) `initialize-payment`'s tx_ref-reuse-on-retry design is correct against this codebase's own logic, but its actual behavior against Chapa's real `/v1/transaction/initialize` endpoint under a still-open prior session was not verifiable statically.

---

## VERIFIED CORRECT

- **20-minute slot generation** (`lib/slotGeneration.ts` `getAvailableSlots()`): contiguous, non-overlapping, correctly bounded (09:00–17:00 → last slot 16:40, ends exactly at 17:00); server-side `_validate_scheduled_slot`'s bounds check mirrors it exactly for grid-aligned requests.
- **Ethiopia-timezone/DST design**: fixed UTC+3, no DST, deliberately anchored independent of device timezone across client (`nowInEthiopia`, `Intl.DateTimeFormat` with explicit `timeZone`) and server (`AT TIME ZONE 'Africa/Addis_Ababa'`) — sound architecture, correctly implemented everywhere except the M2 display bug.
- **Server-clock authority** (`lib/serverClock.ts`/`get_server_time()`, migration 082): NTP-style round-trip-corrected sync, 5-minute resync, correctly threaded into all real slot-availability/past-slot decisions in both Booking and Reschedule sheets; matched by an identical 2-minute grace guard server-side.
- **Slot-lock TTL-on-confirm lifecycle** (migration 075): trigger-based, covers every write path uniformly (webhook, edge function, direct client), extends to `infinity` on confirmation and deletes on any terminal status — closes the previously-documented "booked slot silently reopens after 10 minutes" bug completely.
- **Server-authoritative pricing**: `book_appointment_slot()` (migration 089) ignores caller-supplied price entirely, deriving it from `doctor_profiles` server-side.
- **Rate limiting**: both booking (10 attempts/10 min) and payment initialization, both deliberately fail-open on limiter infrastructure errors (a considered tradeoff, not an oversight).
- **Webhook idempotency and authenticity**: `chapa-webhook`'s core flip (`.eq('chapa_tx_ref', trx_ref).neq('payment_status','paid')`) makes a duplicate webhook call for the same `tx_ref` a guaranteed no-op; no HMAC is checked, but state only mutates after independently re-verifying with Chapa's own server-to-server verify API — an attacker cannot forge a payment.
- **Full-coverage credit-apply path**: correctly atomic (`UPDATE ... WHERE credit_used=false`), unlike the partial-coverage branch (H1).
- **Financial-column tamper guard** (migration 089): correctly blocks all payment/credit column writes from non-service-role callers, verified against every real write site.
- **Status-transition whitelist** (migration 097, current): matches every real client call site across 11 enumerated `.update({status:...})` call sites in the app; the historical patient-self-promotion fraud vector (self-PATCHing to `completed`/`accepted`) remains correctly blocked, re-verified specifically for the scheduled-flow statuses too.
- **Queue-activation cascade bypass** (migration 092's `carehub.system_status_write` GUC) is correctly scoped as a transaction-local flag inside one function only, not a blanket bypass.
- **Rescheduling correctness**: old slot released / new slot locked atomically, ownership-checked, re-validated against the identical day-off/hours/timezone logic as fresh booking, rejects past times, and correctly resets all reminder flags without creating duplicate rows or duplicate reminder streams.
- **`'rescheduled'` vs `'scheduled_booking'` notification events**: correctly disambiguated via mutually exclusive `IF/ELSIF` branches — cannot double-fire.
- **Doctor accept/decline concurrency**: optimistic-concurrency guards (`.eq('status','waiting_for_doctor')`) with correct "0 rows matched = already resolved elsewhere, not an error" handling.
- **Reminder timing**: migration 095's fix (catch-up margin anchored to the near edge, never the far edge) verified to guarantee reminders can only fire on-time or late, never early, across all three tiers.
- **PII on lock screen / notification payloads**: Android channel uses `PRIVATE` visibility; every doctor-facing push body deliberately omits patient name from the actual notification title/body (kept only in the data payload / in-app record) — consistent with, not a new instance of, this codebase's prior lock-screen-privacy fix.
- **No duplicate waiting-room or incoming-request screen instances**: every navigation entry point re-scans the tree and re-verifies live status before routing, both for fresh notification taps and for stale/queued ones.
- **`slot_locks` SELECT RLS**: intentionally open to all authenticated users, verified non-sensitive (exposes only `doctor_id`/`slot_start`/`slot_duration`, never patient identity) — correctly reachable by patient clients after migration 080's fix to the original broken policy.
- **`get_user_id_from_jwt_sub()`/`get_doctor_profile_id()` identity resolution**: consistently used (never bare `auth.uid()`) across every scheduling-relevant policy/function reviewed; the one historical exception (`consultation_reports`) was already found and fixed by migration 089.
- **`dev-payment-bypass`'s client-side gating**: `__DEV__` compiled to `false` in release bundles independent of env vars; `.env` confirmed git-ignored and absent from every EAS build profile — a real, verified layer of defense in depth on top of the server-side single-secret gate (M6).
- **`realtimeChannelManager.ts`'s `subscribeRealtime()`**: correctly ref-counted, single registration per topic, grace-period teardown to survive same-tick unmount/remount races — the *correct* pattern that M9/M10's stragglers should be migrated onto, already adopted successfully by `usePatientAppointments.ts`, `useDoctorOnlineToggle.ts`, and the doctor Home/Consultations tabs.
- **Patient-side app-wide recovery** (`app/_layout.tsx`): both the general consultation-recovery and waiting-room-recovery effects correctly pair foreground `AppState` checks with genuine realtime subscriptions, with stable topics and `getChannels()` staleness guards — the pattern M3 found missing on the doctor side.
- **Cron job naming**: every `cron.schedule()` call across all migrations reuses the same job name per job, which Postgres treats as an upsert — no duplicate/orphaned job registrations found.
- **Doctor-driven scheduled-activation cron**: correctly activates only the earliest-due appointment per doctor, only when the doctor isn't already occupied by another active/waiting consultation — verified consistent between the plain cron path and the cascade-activation path.

---

## RUNTIME VERIFICATION REQUIRED

- **C1's exploits (a–e):** each requires an actual authenticated PostgREST call against the live database to confirm the RLS gap behaves as read (e.g. `PATCH .../consultations?id=eq.&lt;own-id&gt; {"doctor_id":"..."}` then check the reassigned doctor's session can `SELECT` the row/messages). Static reading is unambiguous from the SQL; live confirmation was not performed.
- **H1's double-credit-consumption:** needs an end-to-end reproduction against a Chapa sandbox — issue a credit, start two partial-credit bookings against different doctors without completing either, then complete both and check whether the discount was applied twice against Chapa's actual charged total.
- **H2's calendar-griefing:** needs a live `INSERT INTO slot_locks` for a doctor/slot the caller doesn't own, followed by a concurrent `book_appointment_slot()` attempt for that exact slot, to confirm the real-world block.
- **H3's cold-relaunch race:** needs a physical device test — kill the app mid-Chapa-checkout, artificially delay webhook delivery past 90 seconds, relaunch via the stored pending-payment recovery path, and observe whether the client cancels while the webhook later resurrects the row.
- **H4's late-webhook-resurrect swallow:** needs a controlled test holding a real Chapa transaction past the 30-minute stale-sweep while a second patient retakes the freed slot, then letting the original webhook land late.
- **H5's off-grid/overlap RPC exploit:** needs a live call to `book_appointment_slot()` with a hand-crafted off-grid `p_slot_start` and/or non-standard `p_slot_duration` using a real Clerk token, to confirm it isn't blocked by an out-of-repo hotfix or a grant-level restriction not visible in migration source.
- **M1's duplicate-notification TOCTOU:** needs either Postgres/edge-function log inspection for repeated dispatches against the same `(consultation_id, kind)` within one cron tick, or a deliberately slowed edge-function invocation under load.
- **M3's doctor-banner gap:** needs a live two-device test — doctor foregrounded on a non-Home/Consultations tab, second party/cron triggers an accept or auto-activation, observe whether the banner updates without a foreground toggle.
- **M9/M10's channel-churn frequency:** actual overlap-window duration during rapid day-tapping or Schedule-tab remounts depends on real device timing (async `removeChannel()` resolution speed vs. re-trigger speed) — not resolvable from static code.
- **M6:** whether `DEV_PAYMENT_BYPASS_ENABLED` is actually unset/false in the production Supabase project's secrets — this single value is the entire remaining security boundary for that endpoint; not visible from the repository.
- **General offline/reconnect device behavior** for scheduling screens (connectivity loss mid-booking-sheet, OS-suspended sockets during an open Schedule-tab subscription) — code paths look structurally sound (full-refetch-on-reconnect, `AppState`-driven resyncs) but were not exercised on physical Android/iOS devices, consistent with this project's standing live-verification policy.
- **Scale behavior (M8/M12/M13):** actual query latency/payload-size degradation at thousands-of-appointments/thousands-of-doctors scale cannot be measured from source alone — needs either a seeded-staging load test or production metrics once real volume exists.
- **pg_cron overlap semantics:** whether the live Supabase project's pg_cron configuration permits overlapping runs of the same job name if a previous invocation is still executing — the determining factor for L2's real-world likelihood and a contributing factor to M1.

---

## RECOMMENDED FIX ORDER

1. **C1 — Add `WITH CHECK`/guard trigger to `consultations_update`** — single highest-impact fix in this entire audit; closes five separate exploit vectors at once (cross-tenant leak, fabricated appointments, price fraud, queue-jumping, booking-integrity bypass) and is a straightforward, well-precedented pattern in this codebase (089/094/098 already establish it for other tables).
2. **C2 — Add `'scheduled'` to the credit-issuance trigger's status list**, then add a real patient-facing cancel action for that state — closes an active, ongoing financial-loss path that fires on legitimate admin use, not just theoretical attacker action.
3. **H2 — Drop or restrict the open `slot_locks` INSERT policy** — trivial, isolated fix for a zero-cost, unauthenticated-relationship-required calendar-griefing vector.
4. **H1 — Make the partial-credit-apply branch atomic** — mirrors a pattern already correctly implemented two lines away in the full-coverage branch; low effort, closes a real revenue-leak path.
5. **H4 — Fix `chapa-webhook`'s swallowed unique-violation** on the late-payment resurrect path — narrow, well-understood fix (detect the specific error, route to credit-issuance or a reconciliation flag instead of `console.error`).
6. **H3 — Persist payment status across app kills** in `lib/pendingPayment.ts`, or simply stop auto-cancelling from the cold-relaunch path — prevents a confusing false "not charged" message and the resulting double-payment risk.
7. **H5 — Add grid-alignment/duration validation to `_validate_scheduled_slot()`** — closes the gap between client convention and server invariant; not urgent (unreachable via shipped UI) but cheap once C1's guard-trigger work is already in flight.
8. **M1 — Make the notification/reminder "mark as sent" claim atomic** across `trigger_appointment_notifications`/`trigger_appointment_reminders` — one SQL-pattern fix applied in two places, closes a recurring duplicate-push annoyance.
9. **M2 — Fix booked-slot display timezone bug** in `BookingModal.tsx`/`RescheduleModal.tsx` — reuse the same Ethiopia-anchored helpers already present in `lib/slotGeneration.ts`.
10. **M9/M10 — Migrate the remaining `Date.now()`-suffixed realtime channels** (`BookingModal`, `RescheduleModal`'s doctor-availability channel, doctor `Schedule.tsx`) onto the existing `subscribeRealtime()` manager — same fix, applied to the last known stragglers of a pattern this project has now fixed in five other places.
11. **M3 — Add a realtime subscription to the doctor's global active-consultation recovery effect**, mirroring the already-correct patient-side implementation in the same file.
12. **Remaining Medium items (M4–M8, M11–M14, M16)** — batch as a scheduling-polish pass: reschedule reminder-tier gap, `slot_locks`-vs-`consultations` display lag/error-message gap, `dev-payment-bypass` defense-in-depth guard, unbounded patient-appointments/doctor-directory queries, doctor Schedule pagination cap, fail-open time parsing, `doctor_profiles_update` WITH CHECK.
13. **Low items (L1–L9)** — capacity-planning/documentation/consistency cleanup, no urgency.

---

*This document is the deliverable for Phase 4. No code was modified, no migrations created, nothing deployed. All findings above are traceable to specific files/lines read during the audit; items marked "Runtime Verification Required" are explicitly flagged as unconfirmed by static analysis alone.*

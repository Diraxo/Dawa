# Release QA Checklist — Teleconsultation Flow

This is the manual test plan for the items that cannot be verified by an
automated test in this environment: device hardware (ringtone, vibration,
full-screen intent, lock screen), real network conditions, and multi-device
timing. Where a section is also covered by an automated test, that's noted
so you know what's already locked in vs. what only this checklist protects.

Run this against a real build (EAS build or `expo run:android`/`expo
run:ios`, not Expo Go — CallKeep, full-screen intent, and the Notifee
chronometer notification all require a native build) with two physical
devices: one doctor, one patient. A second physical device is not optional
for section 6 — an emulator cannot show a locked-screen full-screen intent
call UI reliably.

Automated coverage that backs this checklist:
- `__tests__/deriveCallState.test.ts` — the doctor/patient call-phase state
  machine (drives item 1 and item 3), run with `npm test`.
- `__tests__/callDuration.test.ts` — the shared timer formatter (item 2).
- `__tests__/heartbeatGateConsistency.test.ts` — guards the exact bug fixed
  in this pass (see final report): heartbeat must stay alive through
  'reconnecting' in all 4 doctor call screens, or the 10-minute stale-session
  cron silently ends the call.
- `__tests__/ghostConsultationGuards.test.ts` — item 5.
- `carehub-web/e2e/consultation.spec.ts`, `api.spec.ts` — page-load smoke
  checks and unauthenticated API protection (run with `npm run test:e2e` in
  `carehub-web/`, needs `E2E_DOCTOR_PASSWORD`/`E2E_PATIENT_PASSWORD` env vars
  and a running server).

---

## 1. Doctor can always end the consultation

Setup: doctor and patient both join a video (repeat for voice) consultation
until it reaches "connected"/timer running, then reproduce each patient
failure below. After each one, doctor taps **End Consultation** and confirms
the summary form opens immediately — not a "Cancel Call"/"Cancel Outgoing
Call" dialog.

| # | Scenario | How to reproduce | Pass criteria |
|---|---|---|---|
| 1 | Patient never joins | Doctor accepts/joins, patient never opens the call screen | Doctor sees "Waiting for patient…", End Consultation opens summary |
| 2 | Patient closes the app | Mid-call, patient backgrounds then force-quits from the app switcher | Doctor sees Reconnecting, End Consultation opens summary |
| 3 | Patient loses internet | Mid-call, enable Airplane Mode on patient device | Doctor sees Reconnecting, End Consultation opens summary |
| 4 | Patient stuck on "Connecting" | Patient joins but throttle their network to near-zero before media flows | Doctor sees Waiting/Connecting, End Consultation opens summary |
| 5 | Patient stuck on "Reconnecting" | Toggle patient's Airplane Mode on/off repeatedly for 12+ minutes without ever fully reconnecting | **Critical**: wait past 10 minutes. Doctor must still see Reconnecting and End Consultation must still open the summary — this is the exact scenario the heartbeat fix in this release targets. If the doctor gets auto-navigated to "Call Ended" with no summary form before they tap anything, the fix did not hold — re-check `useHeartbeat(...)` in the doctor call screen actually deployed to the test build. |
| 6 | Patient force-closes the app | Swipe the patient app away from recents mid-call | Same as #2 |
| 7 | Patient's phone dies | Power off the patient device mid-call | Same as #3, but no graceful disconnect signal is sent — confirm the doctor side still recovers via the 10-minute heartbeat/cron path, not sooner |

Also verify: after the consultation has been **accepted** (doctor and
patient both connected at least once), the doctor must never see "Cancel
Call" or "Cancel Outgoing Call" again for that consultation, in any of the
above scenarios or after backgrounding/foregrounding the doctor's own app.

## 2. Timer synchronization

With both devices on a live call, screen-record or screenshot all four
surfaces within the same second:
1. Patient call screen timer
2. Doctor call screen timer
3. Sticky/persistent call banner (minimize the call screen on either device to surface it)
4. Android ongoing-call notification (pull down the notification shade)

Pass: all four show the same MM:SS (or H:MM:SS after an hour) within 1
second of each other. Re-check after a 2+ minute backgrounding of the doctor
app (JS thread suspension risk) and after a patient reconnect (resync
point). The notification chronometer is OS-driven and should never drift;
if it does, that's a distinct bug from the JS-timer surfaces drifting.

## 3. Connection state

On a live call, force a one-sided network blip (Airplane Mode toggle) on
just the **patient** device and watch both screens simultaneously.

Pass: both devices always show a state consistent with the actual call
health. Fail example to catch: doctor showing "Connecting" while patient's
own screen already shows a running "5:42" timer, or vice versa — this
indicates one side inferred connection state from local Agora events that
disagree with the DB-driven phase the other side is reading. Repeat with the
blip on the **doctor's** device instead, watching for the same thing from
the patient's perspective.

## 4. Doctor profile updates

From the doctor's Edit Profile screen, change name, photo, specialty, and
hospital one at a time (or together) while a patient has each of these
screens open on a second device: waiting room, incoming consultation alert,
a push notification banner, chat thread, an active call screen, a
consultation summary, and the messages list.

Pass: each surface updates to the new value without the patient needing to
reload/reopen the screen. Note which (if any) surface only updates on next
navigation rather than live — that's a gap even if not a hard failure.

## 5. Ghost consultation

Reproduce with a chat, voice, and video consultation each:
1. Doctor sends an "incoming request" push, but does not open it yet.
2. From a different path, let the consultation resolve (patient cancels, or
   it times out to missed) before the doctor taps the original notification.
3. Doctor now taps the stale notification.

Pass: doctor lands on the consultation list or the (now-completed/missed)
consultation's own detail screen — never an incoming-call ringing UI with
"Doctor" as a placeholder name, a blank avatar, an auto-decline countdown,
or a ringtone. Repeat the same test from the **patient** side for a
"waiting"/"tap to join" notification tapped after the consultation has
already ended.

## 6. Notifications

For **both** patient and doctor, in **all four** app states (open/foreground,
backgrounded, killed/swiped away, and device locked), trigger an incoming
consultation request/call and verify:

- [ ] Ringtone plays
- [ ] Vibration fires
- [ ] Full-screen incoming-call UI appears (Android `USE_FULL_SCREEN_INTENT` — this bypasses the lock screen; verify it actually does on the real device, not just a heads-up banner)
- [ ] Tapping the notification opens the correct screen for the correct consultation
- [ ] Accept works from the notification/full-screen UI directly (not just from within the app)
- [ ] Decline works the same way, and the other party sees the decline promptly

This is 2 roles × 4 app states × 2 call types (chat push vs. voice/video
CallKeep-style call) = several dozen concrete checks; budget real device
time for this section specifically, on both a recent and an older Android
OS version (see the device matrix in the final report).

## 7. Scheduled consultation

1. Patient books a future slot for a specific doctor.
2. Immediately (without refreshing) check the doctor's **Today's Schedule**
   and **Upcoming Schedule** — the new booking should already be there.
3. Immediately check the patient's own appointments list — the slot should
   show as booked, rendered in red/booked styling, and unclickable to
   patients trying to book the same slot.
4. From a second patient account (or incognito), try to book the same slot —
   confirm it's rejected/hidden as unavailable, and that this holds even 9+
   minutes after booking (this exercises the migration 075 fix for the old
   10-minute slot-lock TTL bug — confirm you are NOT able to reproduce the
   old "slot silently reopens after 10 minutes" behavior).

## 8. Consultation summary

1. Doctor completes a consultation and submits the summary form.
2. Patient should receive a push notification promptly.
3. Tapping it (or navigating to the summary manually) should show a "View
   Summary" entry with the **current** doctor name/photo (change the
   doctor's photo beforehand and confirm the summary doesn't show a cached
   old one) and a working PDF export/print.

## 9. Regression

Run one full consultation start-to-finish of each type end-to-end on both
platforms (mobile + web where applicable) with no failures injected:
- [ ] Chat consultation
- [ ] Voice consultation
- [ ] Video consultation

This is the baseline sanity check — if any of the failure-injection testing
above required code changes, re-run this section last to confirm nothing
broke the happy path.

## 10. Final report format

When this checklist (or any subset of it) has been executed, the report
back should include, not just "fixed":
- Root cause of each bug found
- Files changed
- Functions changed
- Edge Functions changed (if any)
- Database changes (migration numbers, whether applied to the live/linked
  Supabase project or only written)
- Which items were verified on a real device vs. code-reviewed only
- Android OS versions actually tested
- Remaining limitations / not-yet-verified items

See the accompanying session report for the current pass's version of this.

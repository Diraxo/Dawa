# Phase 6 — Notification Reliability & Multi-Device Device QA Checklist

**Date:** 2026-07-31
**Scope:** Manual device verification for the Phase 6 notification-infrastructure completion pass (migrations 109/110, `handle-consultation-notification`, `send-appointment-notification` — deployed live, **not yet click-through tested on any physical device**). Companion to `phase6-notification-reliability-completion-2026-07-31.md`.

No device testing was performed as part of this pass — everything below is a checklist for the user/QA to execute, not a report of completed verification. Check off each item on a real Android and/or iOS device; note actual vs. expected next to any failure.

---

## Multi-device (Issue 1 — `user_devices`, migration 109)

- [ ] Sign in on Device A (Android) → confirm a row appears in `user_devices` for that account with `platform='android'` and `expo_push_token`/`fcm_token` populated
- [ ] Sign in on Device B (iOS), same account, without signing out of Device A → confirm Device A's row is untouched and a **second** row now exists for Device B
- [ ] Trigger a consultation-request push (e.g. book an on-demand consultation as a patient against this doctor account) → **both** devices ring/receive the push, not just the most-recently-registered one
- [ ] Log out on Device A only → Device A's `user_devices` row goes `active=false` with nulled tokens; Device B's row is untouched and Device B still receives pushes afterward
- [ ] Force-quit and relaunch Device A (still signed in, no logout) → confirm its `user_devices` row is refreshed (`last_seen_at` bumped), not duplicated into a second row for the same `device_id`
- [ ] Uninstall/reinstall the app on Device A → confirm a **new** device row is created (new `device_id`) rather than reusing the old one, and the old row eventually stops being sent to (still `active=true` but token dead — confirm the DeviceNotRegistered/UNREGISTERED clearing path nulls its token after one failed send)
- [ ] Phone/video call ring: Android device (FCM/ConnectionService) and iPhone (VoIP/CallKit) signed into the same account both ring independently when a call-type consultation request arrives — confirms the "both channels attempted unconditionally" fix, not just whichever token happened to be legacy-registered

## Reliable scheduled reminders (Issue 2 — migration 105 regression fix)

- [ ] Book a scheduled consultation ~35 minutes out → confirm the 30-minute reminder arrives on time
- [ ] Temporarily break `INTERNAL_NOTIFICATION_SECRET` (or otherwise force `send-appointment-notification` to fail) right as a reminder tier claims a row → confirm `notification_claimed_at`/`reminder_*_claimed_at` is set but `*_confirmed_at` stays null, and that `retry-unconfirmed-appointment-notifications` (5-minute cron) re-fires it once the secret is restored — the reminder should still arrive, just late, not be silently lost
- [ ] Confirm a normally-successful reminder does **not** get double-sent by the retry sweep (its `*_confirmed_at` should be set within moments of send, before the sweep's 3-minute staleness window)

## Retry for event-driven consultation notifications (Issue 3)

- [ ] For at least 3 of: Consultation Accepted, Declined, Cancelled, Completed, Doctor Joined, Doctor Left, Patient Joined, Patient Left, Summary Ready, Payment Success/Failure, Rating Reminder — confirm each still fires normally (no regression from the dispatch-log wrapping)
- [ ] Simulate a transient failure on `handle-consultation-notification` (e.g. redeploy with a temporary throw right after the auth check) for one event → confirm the row lands in `notification_dispatch_log` with `confirmed_at IS NULL`, and that `retry-unconfirmed-consultation-notifications` (2-minute cron) re-delivers it once the function is healthy again
- [ ] Confirm **ordering**: force an early event's retry to be delayed past when a later event for the *same* consultation has already confirmed (e.g. delay `accepted`'s retry past `completed` already having fired) → confirm the stale `accepted` retry is suppressed rather than landing after `completed`
- [ ] Confirm no duplicate push/in-app row appears for an event that succeeded on the first attempt (dispatch-log `confirmed_at` should prevent the sweep from ever re-touching it)

## Replay protection (Issue 4)

- [ ] Capture a legitimate request to either edge function (e.g. via Supabase function logs) and manually replay the exact same nonce/timestamp/body → confirm it's rejected with `409 Duplicate or invalid request nonce`
- [ ] Replay the same body with a timestamp older than 5 minutes → confirm `400 Request expired or timestamp invalid`
- [ ] Confirm a normal, freshly-triggered event (fresh nonce every time) is unaffected — no false-positive rejections in production logs after deploy

## Web push (Issue 5 — VAPID now configured)

- [ ] On carehub-web, grant notification permission as a signed-in patient or doctor → confirm a row appears in `web_push_subscriptions`
- [ ] Trigger any event-driven or scheduled notification while the browser tab is closed → confirm the OS-level browser notification appears (service worker `push` handler)
- [ ] Click the browser notification → confirms `notificationclick` in `sw.js` focuses/opens the right URL
- [ ] Confirm `NEXT_PUBLIC_VAPID_PUBLIC_KEY` has actually been added to the live Vercel project env vars and the site redeployed — **this step is required before any of the above can work**; it was not done as part of this pass (see completion report, "remaining limitations")

## Full notification-type × platform × app-state matrix (Issue 6)

For each notification type below, verify on **Android** and **iPhone**, with the app **open**, **backgrounded**, and **fully closed** — confirm: push received, badge updated, correct icon/title/body, correct deep link/destination screen, no duplicate, correct behavior across multiple signed-in devices.

- [ ] New Consultation Request (+ CallKit/VoIP ring on iPhone, ConnectionService on Android, for phone/video)
- [ ] Consultation Accepted
- [ ] Consultation Declined
- [ ] Consultation Cancelled
- [ ] Consultation Completed
- [ ] Doctor Joined
- [ ] Doctor Left
- [ ] Patient Joined
- [ ] Patient Left
- [ ] Scheduled Reminders (30/10/5 min)
- [ ] Payment Success
- [ ] Payment Failure
- [ ] Rating Reminder
- [ ] Summary Ready
- [ ] Summary Updated
- [ ] Withdrawal Approved
- [ ] Withdrawal Rejected
- [ ] Withdrawal Paid
- [ ] Doctor Approved
- [ ] Doctor Rejected
- [ ] Doctor Suspended
- [ ] Doctor Reinstated
- [ ] Document Approved
- [ ] Document Rejected

Note: several of the types above (Doctor Joined/Left, Rating Reminder, Payment Success/Failure push) depend on the separate, already-written-but-not-yet-applied migrations 107/108 — see the completion report for what is and isn't live.

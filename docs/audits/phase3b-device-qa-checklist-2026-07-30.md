# Phase 3B — Device QA Checklist

**Date:** 2026-07-30
**Scope:** Manual device verification for the Phase 3B chat-reliability fixes (deployed live, not yet click-through tested). Companion to `phase3-consultation-audit-2026-07-30.md` (P3-11 through P3-18, P3-27/28/30).

Check off each item on a real Android and/or iOS device. Anything that fails, note the actual vs. expected behavior next to the box.

---

## Block (P3-12 — `blocked_users` + `block-consultation-peer`)

- [ ] Doctor blocks patient → patient's composer is disabled/rejected server-side, not just hidden client-side
- [ ] Patient blocks doctor → doctor's composer is disabled/rejected server-side
- [ ] Block persists across app restart (not just current screen instance)
- [ ] Block persists on a fresh consultation between the same two users (if intended to be per-consultation, confirm scope; if intended to be global, confirm it carries over)
- [ ] Blocked party's attempt to send via Stream directly (not just via disabled UI) is actually rejected — confirms server-side `banUser()` enforcement, not just a disabled button
- [ ] Reconnect / cold-launch after blocking still shows blocked state (reads back `isBlocked` on mount)

## Attachment validation (P3-14 — `validateChatAttachment()`)

- [ ] JPG — accepted
- [ ] PNG — accepted
- [ ] PDF — accepted
- [ ] DOCX — accepted
- [ ] TXT — rejected (not in allowlist)
- [ ] APK — rejected
- [ ] ZIP — rejected
- [ ] 11 MB PDF — rejected (over 10 MB cap)
- [ ] Renamed executable (e.g. `.exe` renamed to `.pdf`) — confirm behavior (client-side MIME check may not catch this; note if it's a known gap rather than a regression)

## Server-side search (P3-11 — `searchChannelMessages()`)

- [ ] Search matches the first message in a long consultation (older than the locally-loaded page)
- [ ] Search matches the last (most recent) message
- [ ] Search for a message that was never loaded into the local page cache
- [ ] Empty/no-match query shows a proper empty state, not a false negative
- [ ] Search with emoji content
- [ ] Search with non-Latin script (Arabic/Somali) content
- [ ] Debounce (350ms) doesn't feel laggy or fire duplicate queries while typing

## Freeze reconciliation (P3-16 — `chat_frozen_at` + `retry_unfrozen_chat_channels()` cron)

- [ ] Complete a consultation → `chat_frozen_at` gets set promptly
- [ ] Confirm Stream channel is actually frozen (peer's `sendMessage` rejected) immediately after completion
- [ ] Simulate a freeze failure (e.g. temporarily break the vault secret) → confirm the 5-minute cron catches it and re-fires
- [ ] Confirm the `RAISE WARNING` / count surfaces somewhere you'd actually see it (logs/monitoring), not just in a function nobody watches

## Doctor Consultations tab performance (P3-27/28/30)

- [ ] New incoming consultation appears without a full-list refetch
- [ ] Status change (accept/decline) patches just that row
- [ ] Completion patches just that row
- [ ] Cancellation patches just that row
- [ ] Scroll performance with 100+ consultations (FlatList virtualization working)
- [ ] List is capped at 200 and doesn't silently drop a consultation a doctor needs to see (confirm 200 is enough headroom, or that older ones are reachable via History screen)

## Watch-logic cleanup (P3-17/18)

- [ ] Open chat via Home quick action or notification deep link (not via Messages tab) while Messages tab sits mounted-but-unfocused → back out of chat → confirm Messages tab still gets live updates for that channel without needing a manual refocus
- [ ] No duplicate/stale messages appear after the above sequence

---

## Not in scope for this checklist (open, Phase 3C/3D)

P3-04/095 vault-secret regression, P3-19 Agora uid-binding, P3-05 duplicate notification, P3-06 server-clock timers, P3-22 connection-milestone guard, P3-24/25 consultation-reports bucket — tracked separately, not part of this Phase 3B pass.

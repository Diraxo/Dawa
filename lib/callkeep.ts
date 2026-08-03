// lib/callkeep.ts
// Production-grade CallKeep singleton.
//
// iOS  → wraps Apple CallKit via react-native-callkeep
// Android → wraps ConnectionService via react-native-callkeep
//
// Responsibilities:
//   • Initialize CallKit / ConnectionService once on app start
//   • Display the OS incoming-call UI (lock screen, AOD, notification shade)
//   • Emit answer / end events to registered handlers
//   • Prevent duplicate call screens for the same consultation
//   • Dismiss the OS call UI when call ends inside the app
//   • Manage audio session lifecycle (iOS CallKit requirement)
//   • Verify Android's ConnectionService PhoneAccount is actually enabled —
//     registering it (setup()) does not enable it, and an unenabled account
//     makes displayIncomingCall() a silent no-op — and fall back to a
//     Notifee ring when it isn't (see ensurePhoneAccountEnabled below)

import { Platform, Vibration } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { logger } from './logger'

// Lazy-load so Expo Go / web don't crash (no native module registered there)
let RNCallKeep: any = null
try {
  if (Platform.OS !== 'web') {
    RNCallKeep = require('react-native-callkeep').default
  }
} catch (e) {
  logger.warn('[CallKeep] react-native-callkeep not available — development build required')
}

// Lazy-load Notifee — only needed for the Android phone-account-unavailable
// fallback ring below (mirrors the same lazy-require pattern used in
// hooks/useIncomingConsultationAlert.ts and index.js).
let notifeeMod: any = null
let AndroidImportance: any = null
if (Platform.OS === 'android') {
  try {
    const lib = require('@notifee/react-native')
    notifeeMod = lib.default
    AndroidImportance = lib.AndroidImportance
  } catch {
    // development build required
  }
}

// ── Cold-start payload persistence ──────────────────────────────────────────
// When the app is fully killed, the Android incoming-call UI is raised from
// index.js's headless FCM handler — a JS context that dies the moment the
// task returns. If the doctor/patient taps Accept, the OS relaunches the app
// into a BRAND NEW JS context: this module reloads from scratch, so the
// in-memory `pendingCalls` map (populated only by displayIncomingCall() in
// the context that showed the call) is empty and the 'answerCall' listener
// below has nothing to hand to answerHandler. Persisting the payload to
// AsyncStorage (survives across JS context restarts, unlike module state)
// closes that gap — see the fallback read in the 'answerCall' listener.
const PENDING_CALL_TTL_MS = 2 * 60 * 1000
const pendingCallKey = (uuid: string) => `@callkeep_pending_${uuid}`

async function persistPendingCall(payload: IncomingCallPayload) {
  try {
    await AsyncStorage.setItem(
      pendingCallKey(payload.uuid),
      JSON.stringify({ payload, savedAt: Date.now() }),
    )
  } catch {
    // best effort — in-memory pendingCalls still covers the warm-JS case
  }
}

async function loadPersistedCall(uuid: string): Promise<IncomingCallPayload | undefined> {
  try {
    const raw = await AsyncStorage.getItem(pendingCallKey(uuid))
    if (!raw) return undefined
    const { payload, savedAt } = JSON.parse(raw)
    if (Date.now() - savedAt > PENDING_CALL_TTL_MS) return undefined
    return payload as IncomingCallPayload
  } catch {
    return undefined
  }
}

function clearPersistedCall(uuid: string) {
  AsyncStorage.removeItem(pendingCallKey(uuid)).catch(() => {})
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface IncomingCallPayload {
  /** Use consultationId as uuid for deduplication */
  uuid:             string
  doctorName:       string
  doctorSpecialty?: string
  doctorPhotoUrl?:  string
  consultationId:   string
  consultationType: 'phone' | 'video'
  doctorId:         string
  doctorClerkId:    string
  agoraChannel:     string
  patientClerkId?:  string
  /** Patient's own identity — only populated when direction === 'doctor'. */
  patientId?:       string
  patientName?:     string
  patientPhotoUrl?: string
  /**
   * Who is ringing whom. Default ('patient', when omitted) is the existing
   * flow: doctor accepted → patient's device rings, doctor is the caller.
   * 'doctor' is a patient's new on-demand request ringing the doctor's
   * device — the *patient* is the caller shown on the OS call UI.
   */
  direction?: 'patient' | 'doctor'
}

type AnswerHandler = (payload: IncomingCallPayload) => void
type EndHandler    = (uuid: string, payload?: IncomingCallPayload) => void

// ── Module-level state ────────────────────────────────────────────────────────

let initialised                  = false
const pendingCalls               = new Map<string, IncomingCallPayload>()
const activeCallUuids            = new Set<string>()
let answerHandler: AnswerHandler | null = null
let endHandler:    EndHandler    | null = null
// Track last call display time to enforce minimum gap (duplicate prevention)
const lastDisplayedAt            = new Map<string, number>()
const MIN_DISPLAY_GAP_MS         = 5_000

// ── Android phone-account / ConnectionService availability ─────────────────────
// Android's ConnectionService (what CallKeep's displayIncomingCall relies on)
// requires the app's PhoneAccount to be both registered AND enabled by the
// user under Settings → Apps → Default apps → Calling accounts. A fresh
// install has it registered (setup() does that) but NOT enabled — nothing
// forces the user through that screen, and if they never see it,
// displayIncomingCall() silently produces no UI at all: no ring, no error,
// nothing. null = not checked yet (treated as available, matching prior
// behavior); false = confirmed unavailable, only ever set by an actual check.
let androidPhoneAccountAvailable: boolean | null = null

// Throttles the actual re-prompt (the setup() re-run below that can pop a
// native Alert + redirect to the phone-accounts Settings screen) — without
// this, a doctor who leaves the account disabled gets that dialog again on
// every single app launch AND every Go Online toggle, which for a doctor
// who toggles online/offline several times a day is a nag, not a nudge.
// Once-per-day is enough to stay in front of the doctor without repeating
// itself within the same session. Never throttles the underlying
// availability *check* (probeAndroidPhoneAccount) — only the prompt.
const PHONE_ACCOUNT_PROMPT_THROTTLE_MS = 24 * 60 * 60 * 1000
const PHONE_ACCOUNT_LAST_PROMPT_KEY = '@callkeep_phone_account_last_prompt'

const RING_VIBRATION_PATTERN     = [0, 700, 400, 700, 400, 700]

// ── Internal helpers ──────────────────────────────────────────────────────────

function notAvailable() {
  return !RNCallKeep || Platform.OS === 'web'
}

// Same tray notification (id/tag `incoming-request-${uuid}`) the doctor's
// chat-request ring already uses (see hooks/useIncomingConsultationAlert.ts
// and index.js's headless handler) — reused here so the existing
// stop-on-open wiring (incoming-request.tsx calls stopIncomingRequestRing on
// mount) also silences this fallback with zero extra plumbing.
//
// Covers both ring directions (see IncomingCallPayload.direction): a
// patient's on-demand request ringing the doctor, and a doctor-accepted call
// ringing the patient. The two need different copy and different tap
// routing — 'doctor' still opens the incoming-request review screen, while
// the patient-facing ring must land straight in the consultation itself
// (there's nothing to review/accept — the call already exists), which is
// exactly what navigateFromNotifeeData's default branch in app/_layout.tsx
// does when `data.screen` isn't 'incoming_request'.
function ringViaNotifeeFallback(payload: IncomingCallPayload) {
  const uuid = payload.uuid
  Vibration.vibrate(RING_VIBRATION_PATTERN, true)
  if (!notifeeMod) return
  const typeTitle = payload.consultationType === 'video' ? 'Video Consultation' : 'Voice Consultation'
  const isDoctorRinging = payload.direction === 'doctor'

  const title = isDoctorRinging ? `New ${typeTitle} request` : `Incoming ${typeTitle}`
  const body = isDoctorRinging
    ? `${payload.patientName || 'A patient'} is waiting for you`
    : `${payload.doctorName || 'Your doctor'} is calling. Tap to join.`
  const data = isDoctorRinging
    ? { screen: 'incoming_request', consultationId: uuid }
    : {
        consultationId:   uuid,
        consultationType: payload.consultationType,
        doctorName:       payload.doctorName,
        doctorId:         payload.doctorId,
        doctorPhotoUrl:   payload.doctorPhotoUrl ?? '',
      }

  notifeeMod
    .displayNotification({
      id: `incoming-request-${uuid}`,
      title,
      body,
      data,
      android: {
        channelId: 'incoming_requests_v2',
        importance: AndroidImportance?.MAX ?? 4,
        category: 'call',
        fullScreenAction: { id: 'default', launchActivity: 'default' },
        pressAction: { id: 'default', launchActivity: 'default' },
        autoCancel: true,
        ongoing: true,
        loopSound: true,
        tag: `incoming-request-${uuid}`,
      },
    })
    .catch(() => {})
}

function stopNotifeeFallback(uuid: string) {
  Vibration.cancel()
  if (Platform.OS === 'android' && notifeeMod) {
    notifeeMod.cancelNotification(`incoming-request-${uuid}`).catch(() => {})
  }
}

// Runs the two Android checks the library exposes for this: ConnectionService
// itself being present on the device, and this app's PhoneAccount being
// enabled. Both must be true for displayIncomingCall() to actually produce
// a ring. Defaults to `true` (available) on any check error — an API failure
// isn't proof of unavailability, and failing closed here would start
// suppressing real calls on devices where CallKeep works fine.
async function probeAndroidPhoneAccount(): Promise<boolean> {
  if (Platform.OS !== 'android' || notAvailable()) return true
  try {
    const [serviceAvailable, hasAccount] = await Promise.all([
      RNCallKeep.isConnectionServiceAvailable?.() ?? true,
      RNCallKeep.hasPhoneAccount?.() ?? true,
    ])
    return !!serviceAvailable && !!hasAccount
  } catch (e) {
    logger.warn('[CallKeep] Phone account availability check failed:', e)
    return true
  }
}

// Shared with ensurePhoneAccountEnabled() below, which re-invokes
// RNCallKeep.setup() with this same config purely to re-run its Android
// side effect of checking + (re-)prompting for the phone-account permission
// — see the doc comment on ensurePhoneAccountEnabled for why setup() itself,
// not some dedicated "check" method, is what actually does that.
const CALLKEEP_OPTIONS = {
  ios: {
    appName:                   'Dawa',
    imageName:                 'AppIcon',
    supportsVideo:             true,
    maximumCallGroups:         '1',
    maximumCallsPerCallGroup:  '1',
    includesCallsInRecents:    false,
    supportsHolding:           false,
    supportsDTMF:              false,
    supportsGrouping:          false,
    supportsUngrouping:        false,
  },
  android: {
    alertTitle:            'Phone account permission required',
    alertDescription:      'Dawa needs access to phone accounts to display incoming consultations.',
    cancelButton:          'Cancel',
    okButton:              'Allow',
    imageName:             'ic_launcher',
    selfManaged:           false,
    additionalPermissions: [],
    foregroundService: {
      channelId:         'dawa_incoming_call',
      channelName:       'Incoming Consultations',
      notificationTitle: 'Incoming Consultation',
      notificationIcon:  'mipmap/ic_launcher',
    },
  },
}

function makeCallerHandle(payload: IncomingCallPayload): string {
  if (payload.direction === 'doctor') {
    return payload.patientName || 'Patient'
  }
  return payload.doctorSpecialty
    ? `${payload.doctorName} · ${payload.doctorSpecialty}`
    : payload.doctorName
}

// ── CallKeep public API ───────────────────────────────────────────────────────

export const callkeep = {

  /**
   * Must be called once at app start (inside ClerkLoaded / after auth).
   * Safe to call multiple times — subsequent calls are no-ops.
   */
  init() {
    if (notAvailable() || initialised) return
    initialised = true

    try {
      RNCallKeep.setup(CALLKEEP_OPTIONS)
    } catch (e) {
      logger.error('[CallKeep] setup failed:', e)
      return
    }

    // ── answerCall ─────────────────────────────────────────────────────────────
    // Fires when the user taps Accept on the OS call screen.
    RNCallKeep.addEventListener('answerCall', ({ callUUID }: { callUUID: string }) => {
      logger.log('[CallKeep] answerCall uuid:', callUUID)

      const payload = pendingCalls.get(callUUID)

      // Clear active/pending state BEFORE dismissing the native call UI —
      // RNCallKeep.endCall() can synchronously re-fire the 'endCall' event on
      // some platforms/versions (ending a call via ConnectionService/CallKit
      // loops back through the same disconnect callback used for a genuine
      // user decline). If activeCallUuids still had this uuid at that point,
      // the endCall listener's `wasActive` check would wrongly be true and
      // mark the consultation 'missed' right after the patient answered.
      activeCallUuids.delete(callUUID)
      pendingCalls.delete(callUUID)
      if (payload) clearPersistedCall(callUUID)

      // Dismiss the native call UI immediately
      try { RNCallKeep.endCall(callUUID) } catch {}

      if (payload && answerHandler) {
        answerHandler(payload)
        return
      }

      // Cold start: this JS context never saw displayIncomingCall() run (the
      // call was raised by index.js's headless handler in a prior, now-dead
      // context) — fall back to the AsyncStorage copy. Read it BEFORE
      // clearing it (loadPersistedCall races clearPersistedCall on the same
      // key otherwise). See the comment above PENDING_CALL_TTL_MS for why
      // this is necessary.
      if (answerHandler) {
        loadPersistedCall(callUUID).then((persisted) => {
          clearPersistedCall(callUUID)
          if (persisted) answerHandler?.(persisted)
          else logger.warn('[CallKeep] answerCall with no known payload (cold start, TTL expired?) uuid:', callUUID)
        })
      }
    })

    // ── endCall ────────────────────────────────────────────────────────────────
    // Fires when the user taps Decline on the OS call screen,
    // or when the call times out, or when the other party cancels.
    RNCallKeep.addEventListener('endCall', ({ callUUID }: { callUUID: string }) => {
      logger.log('[CallKeep] endCall uuid:', callUUID)

      const payload    = pendingCalls.get(callUUID)
      const wasActive  = activeCallUuids.has(callUUID)
      activeCallUuids.delete(callUUID)
      pendingCalls.delete(callUUID)

      if (!wasActive || !endHandler) {
        clearPersistedCall(callUUID)
        return
      }

      if (payload) {
        clearPersistedCall(callUUID)
        endHandler(callUUID, payload)
        return
      }

      // Cold start: same gap as 'answerCall' above — this JS context never
      // ran displayIncomingCall() for this uuid, so `payload` (and its
      // `direction`) isn't in memory. Without it, onEnd's caller can't tell
      // a doctor declining a still-pending request apart from a patient
      // declining an already-accepted call, and those two must be handled
      // differently (see the onEnd handler in app/_layout.tsx). Read the
      // persisted copy BEFORE clearing it.
      loadPersistedCall(callUUID).then((persisted) => {
        clearPersistedCall(callUUID)
        endHandler?.(callUUID, persisted)
      })
    })

    // ── didActivateAudioSession (iOS) ─────────────────────────────────────────
    // CallKit activates the audio session before the user taps Accept.
    // Agora's join happens AFTER this fires so the audio route is ready.
    RNCallKeep.addEventListener('didActivateAudioSession', () => {
      logger.log('[CallKeep] iOS audio session activated')
    })

    // ── didDeactivateAudioSession (iOS) ───────────────────────────────────────
    RNCallKeep.addEventListener('didDeactivateAudioSession', () => {
      logger.log('[CallKeep] iOS audio session deactivated')
    })

    // ── showIncomingCallUi (Android self-managed mode only) ───────────────────
    // Not used here (selfManaged: false) but kept for completeness.
    RNCallKeep.addEventListener('showIncomingCallUi', () => {})

    // ── checkReachability ─────────────────────────────────────────────────────
    // iOS queries whether the app can handle calls; always respond true.
    RNCallKeep.addEventListener('checkReachability', () => {
      if (RNCallKeep?.setReachable) RNCallKeep.setReachable()
    })

    logger.log('[CallKeep] Initialised (platform:', Platform.OS, ')')
  },

  /** Register a handler that fires when the OS call UI is answered. */
  onAnswer(handler: AnswerHandler) {
    answerHandler = handler
  },

  /** Register a handler that fires when the OS call UI is declined / timed-out. */
  onEnd(handler: EndHandler) {
    endHandler = handler
  },

  /**
   * Display the native OS incoming-call UI.
   * Silently deduplicates — if the same uuid was displayed within
   * MIN_DISPLAY_GAP_MS milliseconds it is ignored.
   */
  displayIncomingCall(payload: IncomingCallPayload) {
    if (notAvailable()) return

    const { uuid } = payload
    const now      = Date.now()

    // Duplicate prevention
    const last = lastDisplayedAt.get(uuid)
    if (last && now - last < MIN_DISPLAY_GAP_MS) {
      logger.log('[CallKeep] Duplicate call ignored for uuid:', uuid)
      return
    }
    lastDisplayedAt.set(uuid, now)

    // Android's ConnectionService requires the app's PhoneAccount to be
    // user-enabled (Settings → Apps → Default apps → Calling accounts) —
    // registering it in setup() alone (done in init() above) is not enough.
    // When ensurePhoneAccountEnabled() has confirmed it's NOT enabled,
    // RNCallKeep.displayIncomingCall() below would silently produce no UI at
    // all: no ring, no error, nothing either party could act on. Route
    // through the same Notifee full-screen alert the chat-request flow
    // already uses instead of calling into a native API already known to be
    // a no-op — for both ring directions: a patient's on-demand request
    // ringing the doctor, and a doctor-accepted call ringing the patient.
    // The doctor and patient are equally likely to be the one who never
    // enabled the phone account, so this can't be scoped to one direction.
    if (Platform.OS === 'android' && androidPhoneAccountAvailable === false) {
      logger.warn('[CallKeep] Android phone account unavailable — ringing via Notifee fallback for uuid:', uuid)
      ringViaNotifeeFallback(payload)
      return
    }

    pendingCalls.set(uuid, payload)
    activeCallUuids.add(uuid)
    persistPendingCall(payload)

    const callerHandle = makeCallerHandle(payload)
    const hasVideo     = payload.consultationType === 'video'

    logger.log('[CallKeep] displayIncomingCall uuid:', uuid, 'caller:', callerHandle)

    try {
      RNCallKeep.displayIncomingCall(
        uuid,
        callerHandle,   // handle (shown under caller name on Android)
        callerHandle,   // localizedCallerName (caller name headline)
        'generic',      // handleType: 'generic' | 'number' | 'email'
        hasVideo,       // hasVideo
      )

      // iOS: report that the call was connected from the app's perspective
      // so CallKit doesn't time out before the user acts.
      // Android: no-op.
      if (Platform.OS === 'ios') {
        // Let CallKit show the ringing animation for up to 60 seconds
        setTimeout(() => {
          // Auto-end if the user never responded (missed call)
          if (activeCallUuids.has(uuid)) {
            logger.log('[CallKeep] Ring timeout — ending call uuid:', uuid)
            callkeep.endIncomingCall(uuid)
            if (endHandler) endHandler(uuid, payload)
          }
        }, 60_000)
      }
    } catch (e) {
      logger.error('[CallKeep] displayIncomingCall failed:', e)
      pendingCalls.delete(uuid)
      activeCallUuids.delete(uuid)
      // Reactive fallback — the proactive check above either wasn't run yet
      // or was stale (e.g. the account was disabled after app start without
      // a re-check), so this is the last line of defense against silence.
      // Not scoped to a direction — see the comment above the proactive
      // check for why.
      if (Platform.OS === 'android') {
        ringViaNotifeeFallback(payload)
      }
    }
  },

  /**
   * Programmatically dismiss the OS call UI (e.g. doctor cancelled,
   * patient entered the consultation from a notification tap instead).
   */
  endIncomingCall(uuid: string) {
    // Unconditional and first — a call rung via the Android Notifee fallback
    // (see displayIncomingCall above) never registered with RNCallKeep at
    // all, so it must still be silenced here even when notAvailable() below
    // would otherwise skip the rest of this function.
    stopNotifeeFallback(uuid)
    if (notAvailable()) return
    // Clear state BEFORE calling into RNCallKeep — see the comment in the
    // 'answerCall' listener above for why: ending the call natively here can
    // loop back into the 'endCall' JS event synchronously, and we must not
    // let that stale-read activeCallUuids and misfire endHandler.
    activeCallUuids.delete(uuid)
    pendingCalls.delete(uuid)
    clearPersistedCall(uuid)
    try {
      RNCallKeep.endCall(uuid)
    } catch (e) {
      logger.warn('[CallKeep] endCall failed:', e)
    }
  },

  /**
   * Tell CallKit that the call has been answered and is now connected.
   * Required on iOS so the CallKit timer starts and the call appears
   * in the system recents list correctly.
   */
  reportCallConnected(uuid: string) {
    if (notAvailable() || Platform.OS !== 'ios') return
    try {
      RNCallKeep.reportConnectedOutgoingCallWithUUID(uuid)
    } catch {}
  },

  /**
   * Tell CallKit / ConnectionService the call has ended (patient or doctor
   * ended the consultation from inside the app). Prevents the OS from showing
   * a lingering "call ended" banner.
   */
  reportCallEnded(uuid: string, reason: 'failed' | 'remoteEnded' | 'unanswered' | 'answeredElsewhere' = 'remoteEnded') {
    stopNotifeeFallback(uuid)
    if (notAvailable()) return
    const CXCallEndedReason: Record<string, number> = {
      failed:            1,
      remoteEnded:       2,
      unanswered:        3,
      answeredElsewhere: 4,
    }
    // Clear state BEFORE the native call below — see 'answerCall' comment
    // above. The Android branch (RNCallKeep.endCall) is the one that can
    // loop back into the JS 'endCall' event synchronously.
    activeCallUuids.delete(uuid)
    pendingCalls.delete(uuid)
    clearPersistedCall(uuid)
    try {
      if (Platform.OS === 'ios') {
        RNCallKeep.reportEndCallWithUUID(uuid, CXCallEndedReason[reason] ?? 2)
      } else {
        RNCallKeep.endCall(uuid)
      }
    } catch {}
  },

  /** True if the uuid is currently showing in the OS call UI. */
  isCallActive(uuid: string) {
    return activeCallUuids.has(uuid)
  },

  /** True if the module is available (native build, not Expo Go / web). */
  isAvailable() {
    return !notAvailable()
  },

  /** Retrieve the pending payload for a uuid (e.g. after launch from answer). */
  getPendingCall(uuid: string): IncomingCallPayload | undefined {
    return pendingCalls.get(uuid)
  },

  /**
   * Verify Android's ConnectionService PhoneAccount is registered AND
   * enabled, caching the result for displayIncomingCall()'s synchronous
   * check. Call once at app start (after init()) and again whenever the
   * doctor goes online — a fresh install/registration alone is not enough;
   * the user must separately enable it under Settings → Apps → Default
   * apps → Calling accounts, and the ONE automatic prompt for that (fired
   * once, internally, the very first time init() ever calls
   * RNCallKeep.setup() on a given install) is easy to miss entirely: it's a
   * plain RN Alert that requires a ready foreground Activity, has no retry
   * if dismissed/cancelled, and never fires again afterward. This is the
   * re-check + re-prompt this issue exists to add.
   *
   * react-native-callkeep has no dedicated "check and (re-)prompt" method —
   * `checkPhoneAccountEnabled()` is a passive read (identical to
   * `hasPhoneAccount()`, no UI), and `hasDefaultPhoneAccount()` only
   * targets a narrow Samsung multi-account quirk. The alert-and-redirect
   * side effect lives entirely inside `setup()`'s Android path
   * (`_setupAndroid` in the library's index.js: checks the permission, then
   * shows `CALLKEEP_OPTIONS.android.alertTitle`/`alertDescription`, then on
   * "Allow" opens the phone-accounts settings screen) — so re-running
   * `setup()` with the same options is the actual public API for
   * re-triggering that prompt. Safe to call again: it only re-applies
   * native settings and re-registers the phone account, and does not touch
   * the JS event listeners init() adds (those are separate
   * `RNCallKeep.addEventListener` calls, not part of setup()).
   *
   * No-op (always "available") on iOS/web — CallKit has no equivalent
   * per-app enable step.
   *
   * The availability check itself always runs (cheap, no UI). Only the
   * re-prompt — setup()'s Alert + Settings-redirect side effect — is
   * throttled to once per PHONE_ACCOUNT_PROMPT_THROTTLE_MS, so repeated
   * calls from app start and every Go Online toggle don't nag the doctor
   * with the same dialog back-to-back. Pass `force: true` from a surface the
   * doctor explicitly triggered (e.g. an "Enable Calling" settings action)
   * to bypass the throttle and prompt immediately regardless of when it last
   * fired.
   */
  async ensurePhoneAccountEnabled(promptIfUnavailable = true, opts?: { force?: boolean }): Promise<boolean> {
    if (Platform.OS !== 'android' || notAvailable()) return true

    const available = await probeAndroidPhoneAccount()
    androidPhoneAccountAvailable = available
    logger.log('[CallKeep] Android phone account available:', available)

    if (available || !promptIfUnavailable) return available

    if (!opts?.force) {
      try {
        const lastPrompted = await AsyncStorage.getItem(PHONE_ACCOUNT_LAST_PROMPT_KEY)
        if (lastPrompted && Date.now() - Number(lastPrompted) < PHONE_ACCOUNT_PROMPT_THROTTLE_MS) {
          logger.log('[CallKeep] Phone account prompt throttled — already shown today')
          return available
        }
      } catch {
        // AsyncStorage failure — fail open (prompt anyway) rather than risk
        // silently never prompting again.
      }
    }

    try {
      await AsyncStorage.setItem(PHONE_ACCOUNT_LAST_PROMPT_KEY, String(Date.now()))
    } catch {}

    try {
      await RNCallKeep.setup(CALLKEEP_OPTIONS)
    } catch (e) {
      logger.warn('[CallKeep] setup() re-run (phone account prompt) failed:', e)
    }

    // Re-probe after the prompt flow resolves (Alert dismissed/answered,
    // settings screen opened and returned from, etc). If the doctor
    // actually navigated to Settings and enabled it there, this immediate
    // re-probe can still race their return — the next
    // ensurePhoneAccountEnabled() call (next app start / next go-online)
    // is what ultimately picks that up.
    androidPhoneAccountAvailable = await probeAndroidPhoneAccount()
    return androidPhoneAccountAvailable
  },

  /**
   * Cached result of the last ensurePhoneAccountEnabled() check. `true`
   * until a check has actually run and found otherwise — matches
   * displayIncomingCall()'s fail-open default so an unrun check never
   * itself causes a real call to go unrung.
   */
  isPhoneAccountAvailable(): boolean {
    return androidPhoneAccountAvailable !== false
  },
}

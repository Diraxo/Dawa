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

import { Platform } from 'react-native'
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

// ── Internal helpers ──────────────────────────────────────────────────────────

function notAvailable() {
  return !RNCallKeep || Platform.OS === 'web'
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

    const options = {
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

    try {
      RNCallKeep.setup(options)
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
    }
  },

  /**
   * Programmatically dismiss the OS call UI (e.g. doctor cancelled,
   * patient entered the consultation from a notification tap instead).
   */
  endIncomingCall(uuid: string) {
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
}

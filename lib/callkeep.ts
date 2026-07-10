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
}

type AnswerHandler = (payload: IncomingCallPayload) => void
type EndHandler    = (uuid: string) => void

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

      // Dismiss the native call UI immediately
      try { RNCallKeep.endCall(callUUID) } catch {}

      if (payload && answerHandler) {
        answerHandler(payload)
      }
    })

    // ── endCall ────────────────────────────────────────────────────────────────
    // Fires when the user taps Decline on the OS call screen,
    // or when the call times out, or when the other party cancels.
    RNCallKeep.addEventListener('endCall', ({ callUUID }: { callUUID: string }) => {
      logger.log('[CallKeep] endCall uuid:', callUUID)

      const wasActive = activeCallUuids.has(callUUID)
      activeCallUuids.delete(callUUID)
      pendingCalls.delete(callUUID)

      if (wasActive && endHandler) {
        endHandler(callUUID)
      }
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
            if (endHandler) endHandler(uuid)
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

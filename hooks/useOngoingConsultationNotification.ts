// hooks/useOngoingConsultationNotification.ts
//
// Android-only sticky "call in progress" notification. Not swipeable while
// the call is active, and its timer is an Android chronometer (ticked
// natively by the OS from a fixed epoch), so it stays accurate even if the
// JS thread is suspended — unlike a naive setInterval counter.
//
// iOS intentionally has no equivalent here: patients who reach a call via
// the existing VoIP-push/CallKeep path already get the OS's native
// "return to call" pill once CallKit reports the call connected. Building a
// custom always-on iOS indicator (Live Activity) is a separate, much larger
// ActivityKit widget-extension project and is out of scope.
//
// Driven by the global useActiveConsultationStore rather than any single
// call screen's mount lifecycle: that store already tracks "is there a call
// live right now" across in-app navigation (it's what ActiveCallBanner
// renders from), and already gets cleared to null by the ghost-consultation
// self-heal subscription in app/_layout.tsx when the other party ends the
// call — so this hook doesn't need its own end-of-call detection, it just
// mirrors the store.

import { useEffect, useRef } from 'react'
import { Platform } from 'react-native'
import { logger } from '@/lib/logger'
import { useActiveConsultationStore } from '@/store/activeConsultationStore'
import { formatDoctorName } from '@/lib/nameFormat'

let notifee: any = null
let AndroidImportance: any = null
let AndroidVisibility: any = null
let AndroidCategory: any = null
try {
  if (Platform.OS === 'android') {
    const mod = require('@notifee/react-native')
    notifee = mod.default
    AndroidImportance = mod.AndroidImportance
    AndroidVisibility = mod.AndroidVisibility
    AndroidCategory = mod.AndroidCategory
  }
} catch (e) {
  logger.warn('[OngoingCallNotification] @notifee/react-native not available — development build required')
}

const CHANNEL_ID = 'dawa_ongoing_call'
const NOTIFICATION_ID = 'ongoing-consultation-call'
let channelReady: Promise<void> | null = null

function ensureChannel(): Promise<void> {
  if (!notifee) return Promise.resolve()
  if (!channelReady) {
    channelReady = notifee
      .createChannel({
        id: CHANNEL_ID,
        name: 'Ongoing Consultation',
        importance: AndroidImportance.DEFAULT,
        visibility: AndroidVisibility.PUBLIC,
      })
      .then(() => {})
      .catch(() => {})
  }
  return channelReady ?? Promise.resolve()
}

// Never call every consultation a "call" — phone is "Voice Consultation",
// video is "Video Consultation", matching the wording used everywhere else
// (in-app notifications, push notifications, banners).
const TYPE_TITLE: Record<'phone' | 'video', string> = {
  phone: 'Voice Consultation',
  video: 'Video Consultation',
}

export function useOngoingConsultationNotification() {
  const active = useActiveConsultationStore(s => s.active)
  const shownForRef = useRef<string | null>(null)

  useEffect(() => {
    if (Platform.OS !== 'android' || !notifee) return

    const isCall = active && (active.type === 'phone' || active.type === 'video')

    if (!isCall) {
      if (shownForRef.current) {
        notifee.cancelNotification(NOTIFICATION_ID).catch(() => {})
        shownForRef.current = null
      }
      return
    }

    // Only (re)display when the underlying call changes identity — Android
    // ticks the chronometer itself once shown, so there's no need (and no
    // benefit) to re-issue this every second as elapsedSeconds updates.
    if (shownForRef.current === active!.consultationId) return
    shownForRef.current = active!.consultationId

    // Prefer the real DB started_at (callStartedAtMs) over back-computing
    // from elapsedSeconds — that snapshot can be 0/stale if this fires
    // before the call screen's own DB fetch had resolved, permanently
    // pinning the chronometer to the wrong anchor for the rest of the call.
    const anchorMs = active!.callStartedAtMs ?? (Date.now() - active!.elapsedSeconds * 1000)

    // Patient's counterpart is the doctor — always show the "Dr." prefix;
    // doctor's counterpart is the patient — shown as-is.
    const displayName = active!.role === 'patient'
      ? formatDoctorName(active!.otherPersonName)
      : active!.otherPersonName

    ensureChannel().then(() =>
      notifee
        .displayNotification({
          id: NOTIFICATION_ID,
          title: `${TYPE_TITLE[active!.type as 'phone' | 'video']} with ${displayName}`,
          body: 'Tap to return to your consultation',
          data: {
            screen: 'consultation',
            consultationId: active!.consultationId,
            consultationType: active!.type,
          },
          android: {
            channelId: CHANNEL_ID,
            ongoing: true,
            autoCancel: false,
            showChronometer: true,
            chronometerDirection: 'up',
            timestamp: anchorMs,
            category: AndroidCategory?.CALL,
            ...(active!.otherPersonPhotoUrl ? { largeIcon: active!.otherPersonPhotoUrl } : {}),
            pressAction: { id: 'default', launchActivity: 'default' },
          },
        })
        .catch((e: unknown) => logger.warn('[OngoingCallNotification] displayNotification failed:', e)),
    )
  }, [active])

  // Belt-and-suspenders: clear a lingering notification if this hook's host
  // component ever unmounts while one is still showing (app-level, so in
  // practice only on a full app teardown).
  useEffect(() => {
    return () => {
      if (Platform.OS === 'android' && notifee && shownForRef.current) {
        notifee.cancelNotification(NOTIFICATION_ID).catch(() => {})
      }
    }
  }, [])
}

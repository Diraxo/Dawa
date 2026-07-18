// Shared "where does this notification go" routing logic — used both by the
// push/Notifee tap handlers in app/_layout.tsx and by the in-app Notification
// Center (components/notifications/NotificationCenterView.tsx) tapping a row
// directly. Extracted so both paths stay behaviorally identical instead of
// two independently-maintained copies of the same switch.
import { supabase } from '@/lib/supabase'
import { callkeep } from '@/lib/callkeep'
import { useAuthStore } from '@/store/authStore'

type RouterLike = {
  push: (opts: any) => void
  replace: (opts: any) => void
}

// A doctor tapping an "incoming request" notification/full-screen alert may
// do so well after it was sent — the consultation could already be
// accepted (from another device), cancelled, declined, or expired by then.
// The notification payload is only a snapshot from send time, not live
// truth, so re-check before deciding where to route.
export async function resolveIncomingRequestRoute(
  data: Record<string, any>
): Promise<{ pathname: string; params: Record<string, string> }> {
  const consultationId = data.consultationId as string | undefined
  if (!consultationId) return { pathname: '/(doctor)/(tabs)/consultations', params: {} }

  const { data: row } = await supabase
    .from('consultations')
    .select('status')
    .eq('id', consultationId)
    .maybeSingle()
  const liveStatus = row?.status

  if (liveStatus === 'waiting_for_doctor') {
    return {
      pathname: '/(doctor)/incoming-request',
      params: {
        consultationId,
        consultationType: (data.consultationType as string | undefined) ?? 'chat',
        patientName:      data.patientName    ?? 'Patient',
        patientId:        data.patientId      ?? '',
        patientClerkId:   data.patientClerkId ?? '',
        waitingStartedAt: data.waitingStartedAt ?? '',
      },
    }
  }

  // No longer an incoming request — completed/cancelled/declined/expired, or
  // already accepted/in progress (possibly from another device). Land on the
  // consultation's own history/details entry instead of the dead request.
  if (liveStatus === 'completed') {
    return {
      pathname: '/(doctor)/consultation-summary',
      params: { consultationId, patientName: (data.patientName as string | undefined) ?? 'Patient' },
    }
  }
  return { pathname: '/(doctor)/(tabs)/consultations', params: {} }
}

// Routes to the right screen for a notification's `data` payload — shared by
// push taps, Notifee taps, and the in-app Notification Center.
export function navigateForNotification(
  router: RouterLike,
  userRole: string | null,
  data: Record<string, any>,
) {
  const { screen, consultationId, consultationType, channelId } = data ?? {}

  // Set synchronously, before any navigation below runs, so splash.tsx's
  // own (later-resolving) default-role redirect can see it was beaten to
  // the punch by a real notification deep link and skip stomping over it
  // with a Home replace.
  if (screen) useAuthStore.getState().setPendingNotificationRoute(true)

  // Dismiss any active CallKeep call screen for this consultation
  // (patient tapped the notification instead of the OS call UI)
  if (consultationId && callkeep.isCallActive(consultationId)) {
    callkeep.endIncomingCall(consultationId)
  }

  switch (screen) {
    case 'appointments':
      router.push('/(patient)/(tabs)/appointments')
      break

    case 'chat':
      if (channelId) {
        if (userRole === 'doctor') {
          router.push({ pathname: '/(doctor)/chat-consultation', params: { channelId } })
        } else {
          router.push({ pathname: '/(patient)/chat-consultation', params: { channelId } })
        }
      } else if (userRole === 'doctor') {
        router.push('/(doctor)/(tabs)/messages')
      } else {
        router.push('/(patient)/(tabs)/messages')
      }
      break

    case 'consultation': {
      if (consultationId) {
        const type = consultationType ?? 'chat'
        if (userRole === 'doctor') {
          const pathname =
            type === 'video'
              ? '/(doctor)/video-consultation'
              : type === 'phone'
              ? '/(doctor)/phone-consultation'
              : '/(doctor)/chat-consultation'
          router.replace({
            pathname,
            params: {
              consultationId,
              channelId: consultationId,
              patientName:    data.patientName    ?? 'Patient',
              patientId:      data.patientId      ?? '',
              patientPhotoUrl: data.patientPhotoUrl ?? '',
            },
          })
        } else {
          const pathname =
            type === 'video'
              ? '/(patient)/video-consultation'
              : type === 'phone'
              ? '/(patient)/phone-consultation'
              : '/(patient)/chat-consultation'
          router.replace({
            pathname,
            params: {
              consultationId,
              channelId: consultationId,
              doctorName:    data.doctorName ?? 'Doctor',
              doctorId:      data.doctorId   ?? '',
              doctorPhotoUrl: data.doctorPhotoUrl ?? '',
              fromCallkeep:  '1',
            },
          })
        }
      } else {
        router.replace(userRole === 'doctor' ? '/(doctor)/(tabs)/consultations' : '/(patient)/(tabs)/appointments')
      }
      break
    }

    case 'waiting-room':
    case 'waiting':
      if (consultationId) {
        // The notification could be stale by the time it's tapped — the
        // doctor may have already accepted (or the call may already be
        // live) in the time between it being sent and the tap. Check the
        // live status rather than trusting the notification's payload, so
        // an already-accepted consultation never gets routed through the
        // waiting room at all.
        supabase
          .from('consultations')
          .select('status')
          .eq('id', consultationId)
          .maybeSingle()
          .then(({ data: row }) => {
            const liveStatus = row?.status
            if (liveStatus === 'accepted' || liveStatus === 'in_progress' || liveStatus === 'active') {
              const type = consultationType ?? 'chat'
              const pathname =
                type === 'video' ? '/(patient)/video-consultation' :
                type === 'phone' ? '/(patient)/phone-consultation' :
                '/(patient)/chat-consultation'
              router.replace({
                pathname: pathname as any,
                params: {
                  consultationId,
                  channelId: consultationId,
                  doctorName: data.doctorName ?? 'Doctor',
                  doctorId:   data.doctorId   ?? '',
                  doctorPhotoUrl: data.doctorPhotoUrl ?? '',
                  // The call is already accepted/live by the time this
                  // stale "waiting" notification is tapped — without
                  // this, the phone/video screen defaults to its ringing
                  // UI (fromCallkeep unset, resumeElapsed unset) and
                  // shows a ghost "Doctor is calling you…" auto-decline
                  // countdown over an already-connected or since-ended
                  // call, which can even re-write status:'missed' again.
                  fromCallkeep: '1',
                },
              })
            } else {
              router.push({
                pathname: '/(patient)/waiting-room',
                params: {
                  consultationId,
                  consultationType: consultationType ?? 'chat',
                  doctorName: data.doctorName ?? 'Doctor',
                  doctorId:   data.doctorId   ?? '',
                },
              })
            }
          })
      } else {
        router.push('/(patient)/(tabs)/appointments')
      }
      break

    case 'incoming_request':
      if (consultationId) {
        resolveIncomingRequestRoute(data).then(route => router.push(route as any))
      } else {
        router.push('/(doctor)/(tabs)/consultations')
      }
      break

    case 'consultation_summary':
      if (consultationId) {
        router.push({ pathname: '/(patient)/consultation-summary', params: { consultationId } })
      } else {
        router.push('/(patient)/(tabs)/appointments')
      }
      break

    case 'consultations':
      router.push('/(doctor)/(tabs)/consultations')
      break

    // Scheduled-booking / reschedule notifications — the Consultations
    // tab's "incoming" bucket only shows waiting_for_doctor/pending rows,
    // so a 'scheduled' consultation opened there was previously
    // unclickable dead weight. Schedule is the doctor's actual upcoming-
    // appointments view.
    case 'schedule':
      router.push('/(doctor)/(tabs)/schedule')
      break

    case 'profile':
      if (userRole === 'doctor') {
        router.push('/(doctor)/(tabs)/profile')
      } else {
        router.push('/(patient)/(tabs)/profile')
      }
      break

    default:
      break
  }
}

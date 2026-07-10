import { useEffect, useRef } from 'react'
import { useRouter, useSegments } from 'expo-router'
import { useAuth } from '@clerk/clerk-expo'
import { AppState, AppStateStatus } from 'react-native'
import NetInfo, { NetInfoState } from '@react-native-community/netinfo'

import { getAuthClient } from '@/lib/supabase'

type Role = 'patient' | 'doctor'

// Screens that already own their own realtime/poll-driven navigation for
// their own status transitions (waiting-room watches for 'accepted' itself,
// the live call/chat screens watch for 'ended' themselves). Skipping this
// hook's own redirect while one of them is on screen avoids two independent
// mechanisms racing to router.replace the same transition — which otherwise
// surfaces as a duplicated consultation screen for the patient.
const OWN_NAVIGATION_SEGMENTS = [
  'waiting-room',
  'incoming-request',
  'phone-consultation',
  'video-consultation',
  'chat-consultation',
]

const PATIENT_ROUTE_MAP: Record<string, string> = {
  chat:  '/(patient)/chat-consultation',
  phone: '/(patient)/phone-consultation',
  video: '/(patient)/video-consultation',
}
const DOCTOR_ROUTE_MAP: Record<string, string> = {
  chat:  '/(doctor)/chat-consultation',
  phone: '/(doctor)/phone-consultation',
  video: '/(doctor)/video-consultation',
}

// Statuses that mean "this user must never lose track of this consultation" —
// on relaunch/resume they get routed straight back in, never to Home/tabs.
const ACTIVE_STATUSES = ['waiting_for_doctor', 'accepted', 'in_progress', 'active']

/**
 * DB-driven (not AsyncStorage-driven) active-consultation finder. Runs on
 * mount and whenever the app returns to the foreground, and hard-navigates
 * (router.replace) into the correct waiting room / incoming request /
 * live consultation screen for whichever consultation is still active for
 * this patient or doctor — regardless of how the app was closed (kill,
 * background, refresh) or which device/session last touched it.
 */
export function useActiveConsultationRecovery(role: Role, enabled: boolean) {
  const router = useRouter()
  const segments = useSegments()
  const isOnOwnNavigationScreen = segments.some(seg =>
    OWN_NAVIGATION_SEGMENTS.some(s => seg.includes(s))
  )
  const { getToken, userId: clerkUserId, isSignedIn } = useAuth()
  const lastRedirectKeyRef = useRef<string | null>(null)
  const checkingRef = useRef(false)

  useEffect(() => {
    if (!enabled || !isSignedIn || !clerkUserId || isOnOwnNavigationScreen) return

    const check = async () => {
      if (checkingRef.current) return
      checkingRef.current = true
      try {
        const token = await getToken()
        if (!token) return
        const client = getAuthClient(token)

        const { data: userRow } = await client
          .from('users')
          .select('id')
          .eq('clerk_id', clerkUserId)
          .maybeSingle()
        if (!userRow) return

        let query = client
          .from('consultations')
          .select(`
            id, type, status, started_at,
            doctor:doctor_profiles!doctor_id(id, user:users(full_name, profile_photo_url)),
            patient:users!patient_id(id, full_name, profile_photo_url)
          `)
          .in('status', ACTIVE_STATUSES)
          .order('created_at', { ascending: false })
          .limit(1)

        if (role === 'patient') {
          query = query.eq('patient_id', userRow.id)
        } else {
          const { data: dp } = await client
            .from('doctor_profiles')
            .select('id')
            .eq('user_id', userRow.id)
            .maybeSingle()
          if (!dp) return
          query = query.eq('doctor_id', dp.id)
        }

        const { data } = await query.maybeSingle()
        if (!data) return

        const key = `${data.id}:${data.status}`
        if (lastRedirectKeyRef.current === key) return
        lastRedirectKeyRef.current = key

        const resumeElapsed = data.started_at
          ? String(Math.max(0, Math.floor((Date.now() - new Date(data.started_at).getTime()) / 1000)))
          : undefined

        if (role === 'patient') {
          const doctorInfo   = (data as any).doctor
          const doctorId     = doctorInfo?.id
          const doctorName   = doctorInfo?.user?.full_name ?? 'Doctor'
          const doctorPhotoUrl = doctorInfo?.user?.profile_photo_url ?? undefined

          if (data.status === 'waiting_for_doctor') {
            router.replace({
              pathname: '/(patient)/waiting-room' as any,
              params: { consultationId: data.id, doctorId, doctorName, doctorPhotoUrl, consultationType: data.type },
            })
          } else {
            const route = PATIENT_ROUTE_MAP[data.type ?? 'chat'] ?? PATIENT_ROUTE_MAP.chat
            router.replace({
              pathname: route as any,
              params: {
                channelId: data.id, consultationId: data.id, doctorId, doctorName, doctorPhotoUrl,
                ...(resumeElapsed ? { resumeElapsed } : {}),
              },
            })
          }
        } else {
          const patientInfo   = (data as any).patient
          const patientId     = patientInfo?.id
          const patientName   = patientInfo?.full_name ?? 'Patient'
          const patientPhotoUrl = patientInfo?.profile_photo_url ?? undefined

          if (data.status === 'waiting_for_doctor') {
            router.replace({
              pathname: '/(doctor)/incoming-request' as any,
              params: { consultationId: data.id, patientId, patientName, patientPhotoUrl, consultationType: data.type },
            })
          } else {
            const route = DOCTOR_ROUTE_MAP[data.type ?? 'chat'] ?? DOCTOR_ROUTE_MAP.chat
            router.replace({
              pathname: route as any,
              params: {
                channelId: data.id, consultationId: data.id, patientId, patientName, patientPhotoUrl,
                ...(resumeElapsed ? { resumeElapsed } : {}),
              },
            })
          }
        }
      } catch {
        // Best-effort — next mount/foreground/tab-focus retries.
      } finally {
        checkingRef.current = false
      }
    }

    check()

    const sub = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'active') check()
    })

    let wasOffline = false
    const netSub = NetInfo.addEventListener((state: NetInfoState) => {
      const isOnline = !!state.isConnected && state.isInternetReachable !== false
      if (!isOnline) {
        wasOffline = true
      } else if (wasOffline) {
        wasOffline = false
        check()
      }
    })

    return () => {
      sub.remove()
      netSub()
    }
  // segments.join('/') is intentional: re-run `check()` on every tab/screen
  // navigation (not just mount/foreground/reconnect) so switching from Home
  // to Messages/Profile/Appointments/etc. while a consultation is
  // accepted/in_progress redirects back into it immediately, matching how
  // the web recovery components already re-check on every pathname change.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, isSignedIn, clerkUserId, isOnOwnNavigationScreen, segments.join('/')])
}

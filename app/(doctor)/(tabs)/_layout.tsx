import { useAuth } from '@clerk/clerk-expo'
import { Ionicons } from '@expo/vector-icons'
import { Tabs, useRouter } from 'expo-router'
import { useEffect, useRef, useState } from 'react'
import { Alert, Animated, Pressable, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { colors } from '@/constants/colors'
import { fonts } from '@/constants/fonts'
import { getAuthClient, supabase } from '@/lib/supabase'
import { useDoctorStore } from '@/store/doctorStore'

interface PendingRequest {
  id: string
  type: string
  patientName: string
  patientClerkId: string
  amount: number
}

type IoniconsName = React.ComponentProps<typeof Ionicons>['name']

// Canonical copy — must match carehub-web's admin notification inserts and
// StatusAckNotice.tsx exactly, since doctor_profiles.status_ack (migration
// 057) is a single shared column: whichever platform the doctor opens first
// shows one of these and flips status_ack, so the wording must agree.
const STATUS_COPY: Record<'approved' | 'rejected' | 'suspended', { title: string; body: string }> = {
  approved: {
    title: 'Doctor Application Approved',
    body: 'Your account has been approved. You may now begin accepting patients.',
  },
  rejected: {
    title: 'Doctor Application Rejected',
    body: 'Your application was not approved.',
  },
  suspended: {
    title: 'Account Suspended',
    body: 'Your account has been suspended. Please contact support.',
  },
}

function TabIcon({ name, focused }: { name: IoniconsName; focused: boolean }) {
  return (
    <Ionicons
      name={focused ? name : (`${name}-outline` as IoniconsName)}
      size={24}
      color={focused ? colors.tealGreen : '#9CA3AF'}
    />
  )
}

export default function DoctorTabsLayout() {
  const { userId, getToken } = useAuth()
  const { bottom } = useSafeAreaInsets()
  const { setDoctorStatus } = useDoctorStore()
  const router = useRouter()
  const [pendingRequest, setPendingRequest] = useState<PendingRequest | null>(null)
  const slideAnim = useRef(new Animated.Value(-120)).current
  const profileIdRef = useRef<string | null>(null)
  const shownIdsRef = useRef(new Set<string>())
  const statusAckInFlightRef = useRef(false)
  // Mirrors doctorStatus (store state) but readable synchronously from
  // inside checkForWaiting/realtime callbacks without a stale closure —
  // an unapproved doctor (pending/rejected/suspended) must never see the
  // incoming-request banner or modal, matching web's IncomingRequestOverlay
  // suppression. The DB trigger (migration 056) hard-blocks the accept
  // itself either way, but the UI shouldn't dangle a live Accept button in
  // front of a doctor who isn't allowed to use it.
  const statusRef = useRef<string | null>(null)
  // Mirrors pendingRequest state for synchronous reads inside the realtime
  // callback below, which only runs its setup effect once (deps [userId])
  // and would otherwise close over a stale null.
  const pendingRequestRef = useRef<PendingRequest | null>(null)

  // Consultation recovery already runs continuously in the parent
  // app/(doctor)/_layout.tsx, which stays mounted underneath these tabs at
  // all times — a second copy here just raced the same query/navigation.

  const showBanner = (req: PendingRequest) => {
    pendingRequestRef.current = req
    setPendingRequest(req)
    Animated.spring(slideAnim, { toValue: 0, useNativeDriver: true, tension: 60, friction: 10 }).start()
  }

  const dismissBanner = () => {
    pendingRequestRef.current = null
    Animated.timing(slideAnim, { toValue: -120, duration: 250, useNativeDriver: true }).start(() => {
      setPendingRequest(null)
    })
  }

  const handleAccept = (req: PendingRequest) => {
    dismissBanner()
    router.push({
      pathname: '/(doctor)/incoming-request' as any,
      params: {
        consultationId: req.id,
        consultationType: req.type,
        patientName: req.patientName,
        patientClerkId: req.patientClerkId,
      },
    })
  }

  const handleDeclineBanner = async (req: PendingRequest) => {
    dismissBanner()
    try {
      const token = await getToken()
      if (token) {
        await getAuthClient(token)
          .from('consultations')
          .update({ status: 'declined' })
          .eq('id', req.id)
      }
    } catch {}
  }

  useEffect(() => {
    if (!userId) return
    let cleanup: (() => void) | null = null

    ;(async () => {
      try {
        const token = await getToken()
        if (!token) return
        const client = getAuthClient(token)
        const { data: user } = await client
          .from('users')
          .select('id')
          .eq('clerk_id', userId)
          .single()
        if (!user) return
        const { data: dp } = await client
          .from('doctor_profiles')
          .select('id, status, status_ack')
          .eq('user_id', user.id)
          .single()
        if (!dp) return
        setDoctorStatus((dp.status as any) ?? null)
        statusRef.current = (dp.status as any) ?? null
        profileIdRef.current = dp.id

        const ackStatus = async (profileId: string) => {
          if (statusAckInFlightRef.current) return
          statusAckInFlightRef.current = true
          try {
            const tok = await getToken()
            if (tok) {
              await getAuthClient(tok).from('doctor_profiles').update({ status_ack: true }).eq('id', profileId)
            }
          } catch {} finally {
            statusAckInFlightRef.current = false
          }
        }

        const showStatusAlert = (status: 'approved' | 'rejected' | 'suspended', reason?: string | null) => {
          const copy = STATUS_COPY[status]
          const body = status === 'rejected' && reason ? `${copy.body} Reason: ${reason}` : copy.body
          Alert.alert(copy.title, body, [{ text: 'OK' }])
        }

        // Show the one-time status-change popup. Persisted in the DB
        // (status_ack, migration 057 — shared with web's StatusAckNotice),
        // not AsyncStorage, so it stays dismissed across reinstall,
        // logout/login, and whichever platform (mobile or web) the doctor
        // opens first. Any admin-driven status change resets status_ack to
        // false server-side, so this covers approved/rejected/suspended
        // alike, not just the original "just got approved" case.
        if (
          !dp.status_ack &&
          (dp.status === 'approved' || dp.status === 'rejected' || dp.status === 'suspended')
        ) {
          showStatusAlert(dp.status as 'approved' | 'rejected' | 'suspended')
          ackStatus(dp.id)
        }

        const checkForWaiting = async (tok: string) => {
          // An unapproved doctor (pending/rejected/suspended) must never see
          // an incoming-request banner/modal — matches web's
          // IncomingRequestOverlay ("Unapproved doctors never see the
          // overlay"). The DB trigger from migration 056 already hard-blocks
          // the accept itself; this is the UI-side counterpart.
          if (statusRef.current !== 'approved') return

          const c = getAuthClient(tok)
          // Only treat a consultation as "busy" if started within the last 4 hours,
          // so zombie sessions from previous drops don't permanently block the banner.
          const fourHoursAgo = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString()
          const { data: busy } = await c
            .from('consultations').select('id')
            .eq('doctor_id', dp.id)
            .in('status', ['accepted', 'in_progress', 'active'])
            .gte('started_at', fourHoursAgo)
            .limit(1)
          if (busy && busy.length > 0) return

          const { data: waiting } = await c
            .from('consultations')
            .select('id, type, patient_id, patient_amount')
            .eq('doctor_id', dp.id)
            .eq('status', 'waiting_for_doctor')
            .eq('payment_status', 'paid')
            .order('created_at', { ascending: true })
            .limit(1)
          if (!waiting || waiting.length === 0) return
          const w = waiting[0]
          if (shownIdsRef.current.has(w.id)) return
          shownIdsRef.current.add(w.id)
          const { data: pat } = await c.from('users').select('full_name, clerk_id').eq('id', w.patient_id).single()
          showBanner({
            id: w.id,
            type: w.type,
            patientName: pat?.full_name ?? 'Patient',
            patientClerkId: pat?.clerk_id ?? '',
            amount: w.patient_amount ?? 0,
          })
        }

        // Listen for admin approval/rejection/suspension + new consultations in real time
        const profileChannel = supabase
          .channel(`doctor-tabs-${dp.id}`)
          .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'doctor_profiles', filter: `id=eq.${dp.id}` },
            (payload) => {
              const newStatus = (payload.new as any)?.status
              const newAck = (payload.new as any)?.status_ack
              if (newStatus) {
                setDoctorStatus(newStatus as any)
                statusRef.current = newStatus

                // Status just changed away from approved while a request was
                // showing (or about to show) — pull it down immediately.
                if (newStatus !== 'approved' && pendingRequestRef.current) {
                  dismissBanner()
                }

                if (
                  !newAck &&
                  (newStatus === 'approved' || newStatus === 'rejected' || newStatus === 'suspended')
                ) {
                  showStatusAlert(newStatus, (payload.new as any)?.rejection_reason)
                  ackStatus(dp.id)
                }
              }
            }
          )
          .on('postgres_changes', { event: '*', schema: 'public', table: 'consultations', filter: `doctor_id=eq.${dp.id}` },
            async () => {
              const freshToken = await getToken()
              if (freshToken) await checkForWaiting(freshToken)
            }
          )
          .subscribe()

        // Poll every 6 s as fallback
        const pollInterval = setInterval(async () => {
          const freshToken = await getToken()
          if (freshToken) await checkForWaiting(freshToken)
        }, 6000)

        // Check immediately on mount
        await checkForWaiting(token)

        cleanup = () => {
          supabase.removeChannel(profileChannel)
          clearInterval(pollInterval)
        }
      } catch {}
    })()

    return () => { cleanup?.() }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId])

  return (
    <View style={{ flex: 1 }}>
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: colors.tealGreen,
          tabBarInactiveTintColor: '#9CA3AF',
          tabBarStyle: {
            backgroundColor: colors.mistWhite,
            borderTopColor: colors.steelGrey,
            borderTopWidth: 1,
            paddingBottom: bottom > 0 ? bottom : 4,
          },
          tabBarLabelStyle: {
            fontFamily: fonts.medium,
            fontSize: 11,
          },
        }}
      >
        <Tabs.Screen
          name="home"
          options={{
            title: 'Home',
            tabBarIcon: ({ focused }) => <TabIcon name="home" focused={focused} />,
          }}
        />
        <Tabs.Screen
          name="consultations"
          options={{
            title: 'Consults',
            tabBarIcon: ({ focused }) => <TabIcon name="medical" focused={focused} />,
          }}
        />
        <Tabs.Screen
          name="schedule"
          options={{
            title: 'Schedule',
            tabBarIcon: ({ focused }) => <TabIcon name="calendar" focused={focused} />,
          }}
        />
        <Tabs.Screen
          name="messages"
          options={{
            title: 'Messages',
            tabBarIcon: ({ focused }) => <TabIcon name="chatbubble" focused={focused} />,
          }}
        />
        <Tabs.Screen
          name="profile"
          options={{
            title: 'Profile',
            tabBarIcon: ({ focused }) => <TabIcon name="person" focused={focused} />,
          }}
        />
      </Tabs>

      {/* Incoming request banner — slides in from top on any tab */}
      {pendingRequest && (
        <Animated.View style={[styles.banner, { transform: [{ translateY: slideAnim }] }]}>
          <View style={styles.bannerHeader}>
            <View style={styles.bannerPulse} />
            <Text style={styles.bannerTitle}>New Consultation Request</Text>
            <Pressable onPress={dismissBanner} hitSlop={8}>
              <Ionicons name="close" size={18} color="#fff" />
            </Pressable>
          </View>
          <Text style={styles.bannerPatient}>{pendingRequest.patientName}</Text>
          <Text style={styles.bannerMeta}>
            {pendingRequest.type.charAt(0).toUpperCase() + pendingRequest.type.slice(1)} · KES {pendingRequest.amount}
          </Text>
          <View style={styles.bannerActions}>
            <Pressable
              style={styles.declineBtn}
              onPress={() => handleDeclineBanner(pendingRequest)}
            >
              <Text style={styles.declineBtnText}>Decline</Text>
            </Pressable>
            <Pressable
              style={styles.acceptBtn}
              onPress={() => handleAccept(pendingRequest)}
            >
              <Ionicons name="checkmark-circle" size={16} color="#fff" />
              <Text style={styles.acceptBtnText}>Accept</Text>
            </Pressable>
          </View>
        </Animated.View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  banner: {
    position: 'absolute',
    top: 0,
    left: 12,
    right: 12,
    backgroundColor: colors.tealGreen,
    borderRadius: 16,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 10,
    elevation: 10,
    zIndex: 999,
  },
  bannerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  bannerPulse: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#fff',
  },
  bannerTitle: {
    flex: 1,
    fontFamily: fonts.semiBold,
    fontSize: 13,
    color: '#fff',
  },
  bannerPatient: {
    fontFamily: fonts.bold,
    fontSize: 18,
    color: '#fff',
    marginBottom: 2,
  },
  bannerMeta: {
    fontFamily: fonts.regular,
    fontSize: 13,
    color: 'rgba(255,255,255,0.8)',
    marginBottom: 14,
  },
  bannerActions: {
    flexDirection: 'row',
    gap: 10,
  },
  declineBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.6)',
    alignItems: 'center',
  },
  declineBtnText: {
    fontFamily: fonts.semiBold,
    fontSize: 14,
    color: '#fff',
  },
  acceptBtn: {
    flex: 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.2)',
  },
  acceptBtnText: {
    fontFamily: fonts.bold,
    fontSize: 14,
    color: '#fff',
  },
})

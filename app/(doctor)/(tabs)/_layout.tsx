import { useAuth } from '@clerk/clerk-expo'
import { Ionicons } from '@expo/vector-icons'
import { Tabs, useRouter } from 'expo-router'
import { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Alert, Pressable, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { colors } from '@/constants/colors'
import { fonts } from '@/constants/fonts'
import { getAuthClient, supabase } from '@/lib/supabase'
import { useDoctorStore } from '@/store/doctorStore'

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
  const profileIdRef = useRef<string | null>(null)
  const statusAckInFlightRef = useRef(false)

  // Hard access gate — pending/rejected/suspended doctors must never reach
  // Home/Schedule/Consultations/Messages/Profile, whether that's from a cold
  // launch that skipped Splash's own check, a warm resume, or an admin
  // flipping their status while this screen is already mounted. Splash.tsx
  // performs the same check on cold launch, but relying on that alone left
  // every in-session path (tab switches, backgrounding, realtime status
  // change) unguarded, which is the actual bypass this closes.
  const [statusChecked, setStatusChecked] = useState(false)
  const [blocked, setBlocked] = useState(false)
  // Distinct from `blocked` (pending/rejected/suspended, a real status the
  // doctor needs to see) — this means the status couldn't be verified at
  // all after retries, so it must not be presented as a rejection. Showing
  // "Under Review"/redirecting into registration here would tell an
  // approved doctor with a flaky connection that their account was pulled.
  const [unverifiable, setUnverifiable] = useState(false)
  const redirectedRef = useRef(false)

  const enforceStatus = (status: string | null | undefined) => {
    const allowed = status === 'approved'
    setBlocked(!allowed)
    if (!allowed) {
      if (!redirectedRef.current) {
        redirectedRef.current = true
        router.replace(
          (status === 'pending' || status === 'rejected' || status === 'suspended'
            ? '/(doctor)/registration/under-review'
            : '/(doctor)/registration/step-1') as never
        )
      }
    } else {
      redirectedRef.current = false
    }
  }

  // Consultation recovery, and incoming-request detection/alerting, already
  // run continuously in app/(doctor)/(tabs)/home.tsx (which stays mounted
  // underneath these tabs at all times) plus the shared
  // store/activeIncomingRequestStore.ts single-source-of-truth guard — a
  // second copy here independently detecting the same waiting_for_doctor row
  // and popping its own banner (with no ring/vibrate and no shared-store
  // check) was showing up alongside home.tsx's full-screen incoming-request
  // UI for the same consultation. This layout now only owns the
  // doctor-status (approved/rejected/suspended) ack popup, which is unrelated.

  const [retryTick, setRetryTick] = useState(0)

  useEffect(() => {
    if (!userId) return
    let cleanup: (() => void) | null = null
    let cancelled = false

    const run = async (attempt = 0) => {
      try {
        if (attempt === 0) setUnverifiable(false)
        const token = await getToken()
        if (!token) return
        const client = getAuthClient(token)
        const { data: user } = await client
          .from('users')
          .select('id')
          .eq('clerk_id', userId)
          .single()
        if (!user) {
          enforceStatus(null)
          setStatusChecked(true)
          return
        }
        const { data: dp } = await client
          .from('doctor_profiles')
          .select('id, status, status_ack')
          .eq('user_id', user.id)
          .single()
        if (!dp) {
          enforceStatus(null)
          setStatusChecked(true)
          return
        }
        setDoctorStatus((dp.status as any) ?? null)
        enforceStatus(dp.status)
        setStatusChecked(true)
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

        // Listen for admin approval/rejection/suspension in real time.
        // Incoming-consultation detection lives solely in home.tsx now.
        // Guards against the recurring stale-channel race (see history).
        const tabsTopic = `doctor-tabs-${dp.id}`
        const staleTabs = supabase.getChannels().find((c) => c.topic === `realtime:${tabsTopic}`)
        if (staleTabs) supabase.removeChannel(staleTabs)
        const profileChannel = supabase
          .channel(tabsTopic)
          .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'doctor_profiles', filter: `id=eq.${dp.id}` },
            (payload) => {
              const newStatus = (payload.new as any)?.status
              const newAck = (payload.new as any)?.status_ack
              if (newStatus) {
                setDoctorStatus(newStatus as any)
                enforceStatus(newStatus)

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
          .subscribe()

        cleanup = () => {
          supabase.removeChannel(profileChannel)
        }
      } catch {
        if (cancelled) return
        // Transient network/DB failure — retry a couple of times before
        // failing closed. Failing closed here means "keep blocking access
        // to the dashboard", not "treat as rejected" — see `unverifiable`
        // above for why those two must stay visibly distinct to the doctor.
        if (attempt < 2) {
          setTimeout(() => run(attempt + 1), 1000)
        } else {
          setUnverifiable(true)
          setStatusChecked(true)
        }
      }
    }

    run()

    return () => { cancelled = true; cleanup?.() }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, retryTick])

  // Block rendering the doctor dashboard until status is confirmed
  // 'approved' — covers the initial fetch as well as any later status
  // change (redirect above is already in flight by the time this returns).
  if (unverifiable) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.mistWhite, paddingHorizontal: 32 }}>
        <Ionicons name="cloud-offline-outline" size={40} color="#9CA3AF" />
        <Text style={{ fontFamily: fonts.semiBold, fontSize: 16, color: colors.inkBlack, marginTop: 16, textAlign: 'center' }}>
          Can't verify your account
        </Text>
        <Text style={{ fontFamily: fonts.regular, fontSize: 13, color: '#6B7280', marginTop: 6, textAlign: 'center' }}>
          Check your connection and try again.
        </Text>
        <Pressable
          onPress={() => { setStatusChecked(false); setRetryTick((t) => t + 1) }}
          style={{ marginTop: 20, paddingHorizontal: 20, paddingVertical: 10, borderRadius: 10, backgroundColor: colors.tealGreen }}
        >
          <Text style={{ fontFamily: fonts.semiBold, fontSize: 14, color: '#FFFFFF' }}>Retry</Text>
        </Pressable>
      </View>
    )
  }

  if (!statusChecked || blocked) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.mistWhite }}>
        <ActivityIndicator color={colors.tealGreen} />
      </View>
    )
  }

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
    </View>
  )
}

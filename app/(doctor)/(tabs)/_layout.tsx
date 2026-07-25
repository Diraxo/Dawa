import { useAuth } from '@clerk/clerk-expo'
import { Ionicons } from '@expo/vector-icons'
import { Tabs } from 'expo-router'
import { useEffect, useRef } from 'react'
import { Alert, View } from 'react-native'
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
  const profileIdRef = useRef<string | null>(null)
  const statusAckInFlightRef = useRef(false)

  // Consultation recovery, and incoming-request detection/alerting, already
  // run continuously in app/(doctor)/(tabs)/home.tsx (which stays mounted
  // underneath these tabs at all times) plus the shared
  // store/activeIncomingRequestStore.ts single-source-of-truth guard — a
  // second copy here independently detecting the same waiting_for_doctor row
  // and popping its own banner (with no ring/vibrate and no shared-store
  // check) was showing up alongside home.tsx's full-screen incoming-request
  // UI for the same consultation. This layout now only owns the
  // doctor-status (approved/rejected/suspended) ack popup, which is unrelated.

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
    </View>
  )
}

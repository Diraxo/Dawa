import { useAuth } from '@clerk/clerk-expo'
import { Ionicons } from '@expo/vector-icons'
import { Tabs } from 'expo-router'
import { useEffect } from 'react'
import { Alert } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { colors } from '@/constants/colors'
import { fonts } from '@/constants/fonts'
import { getAuthClient, supabase } from '@/lib/supabase'
import { useDoctorStore } from '@/store/doctorStore'

type IoniconsName = React.ComponentProps<typeof Ionicons>['name']

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
          .select('id, status')
          .eq('user_id', user.id)
          .single()
        if (!dp) return
        setDoctorStatus((dp.status as any) ?? null)

        // Listen for admin approval/rejection in real time
        const channel = supabase
          .channel(`doctor-status-${dp.id}`)
          .on(
            'postgres_changes',
            {
              event: 'UPDATE',
              schema: 'public',
              table: 'doctor_profiles',
              filter: `id=eq.${dp.id}`,
            },
            (payload) => {
              const newStatus = (payload.new as any)?.status
              if (newStatus) {
                setDoctorStatus(newStatus as any)
                if (newStatus === 'approved') {
                  Alert.alert(
                    'Application Approved!',
                    'Congratulations! Your account has been approved. You can now go online and start accepting consultations.',
                    [{ text: 'Start Now' }]
                  )
                } else if (newStatus === 'rejected') {
                  const reason = (payload.new as any)?.rejection_reason
                  Alert.alert(
                    'Application Not Approved',
                    reason
                      ? `Your application was not approved.\n\nReason: ${reason}\n\nPlease contact support@dawa.app for assistance.`
                      : 'Your application was not approved. Please contact support@dawa.app for more information.',
                    [{ text: 'OK' }]
                  )
                }
              }
            }
          )
          .subscribe()

        cleanup = () => supabase.removeChannel(channel)
      } catch {}
    })()

    return () => { cleanup?.() }
  }, [userId])

  return (
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
  )
}

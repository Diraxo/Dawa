import { Ionicons } from '@expo/vector-icons'
import { Tabs } from 'expo-router'
import { ActivityIndicator, View } from 'react-native'

import { colors } from '@/constants/colors'
import { fonts } from '@/constants/fonts'
import { useConsultationPresenceStore } from '@/store/consultationPresenceStore'

type IoniconsName = React.ComponentProps<typeof Ionicons>['name']

function TabIcon({
  name,
  focused,
}: {
  name: IoniconsName
  focused: boolean
}) {
  return (
    <Ionicons
      name={focused ? name : (`${name}-outline` as IoniconsName)}
      size={focused ? 26 : 22}
      color={focused ? colors.tealGreen : '#9CA3AF'}
    />
  )
}

export default function PatientTabsLayout() {
  // Consultation recovery already runs continuously in the parent
  // app/(patient)/_layout.tsx, which stays mounted underneath these tabs at
  // all times — a second copy here just raced the same query/navigation and
  // could redirect twice for the same status transition (seen as a
  // "duplicate consultation" for the patient).
  //
  // What IS read here is that recovery's synchronous cache of "does this
  // patient currently have an active consultation" (consultationPresenceStore) —
  // landing on any tab (e.g. a chat-message notification tapped while a video
  // call is still ongoing) previously showed that tab's content for as long
  // as the parent's DB round trip took before it redirected back, a visible
  // flash. Blocking on the cached flag instead means the redirect the parent
  // is already about to perform never has anything to visibly interrupt.
  const hasActiveConsultation = useConsultationPresenceStore((s) => s.hasActiveConsultation)

  if (hasActiveConsultation) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.mistWhite }}>
        <ActivityIndicator color={colors.tealGreen} />
      </View>
    )
  }

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
        name="doctors"
        options={{
          title: 'Doctors',
          tabBarIcon: ({ focused }) => <TabIcon name="search" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="appointments"
        options={{
          title: 'Appointments',
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

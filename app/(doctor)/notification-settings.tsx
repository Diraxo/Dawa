import { Ionicons } from '@expo/vector-icons'
import { useAuth } from '@clerk/clerk-expo'
import { useRouter } from 'expo-router'
import { useEffect, useRef, useState } from 'react'
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { colors } from '@/constants/colors'
import { fonts } from '@/constants/fonts'
import { shadow } from '@/lib/shadow'
import { getAuthClient } from '@/lib/supabase'

// Maps this screen's toggle ids to notification_preferences columns.
// new_request/messages/account reuse the patient-side columns (same
// meaning); the rest are doctor-only columns added in migration 053.
const COLUMN: Record<string, string> = {
  new_request: 'consultation_request',
  messages: 'messages',
  consultation_update: 'consultation_update',
  earnings: 'earnings',
  reviews: 'reviews',
  account: 'account',
  announcements: 'announcements',
}

interface Setting {
  id: string
  icon: string
  iconColor: string
  title: string
  subtitle: string
  value: boolean
}

const DEFAULT_SETTINGS: Setting[] = [
  {
    id: 'new_request',
    icon: 'medkit-outline',
    iconColor: colors.tealGreen,
    title: 'New Consultation Requests',
    subtitle: 'When a patient books with you',
    value: true,
  },
  {
    id: 'messages',
    icon: 'chatbubble-outline',
    iconColor: colors.interactiveBlue,
    title: 'Patient Messages',
    subtitle: 'New messages in active consultations',
    value: true,
  },
  {
    id: 'consultation_update',
    icon: 'refresh-circle-outline',
    iconColor: colors.careBlue,
    title: 'Consultation Updates',
    subtitle: 'Status changes and cancellations',
    value: true,
  },
  {
    id: 'earnings',
    icon: 'cash-outline',
    iconColor: colors.success,
    title: 'Earnings & Withdrawals',
    subtitle: 'Payment confirmations and updates',
    value: true,
  },
  {
    id: 'reviews',
    icon: 'star-outline',
    iconColor: '#F59E0B',
    title: 'New Patient Reviews',
    subtitle: 'When a patient rates your consultation',
    value: true,
  },
  {
    id: 'account',
    icon: 'shield-checkmark-outline',
    iconColor: '#7C3AED',
    title: 'Account & Security',
    subtitle: 'Login alerts and policy updates',
    value: true,
  },
  {
    id: 'announcements',
    icon: 'megaphone-outline',
    iconColor: '#6B7280',
    title: 'Platform Announcements',
    subtitle: 'Updates, features, and news from Dawa',
    value: false,
  },
]

export default function DoctorNotificationSettingsScreen() {
  const router = useRouter()
  const { getToken } = useAuth()
  const userIdRef = useRef<string | null>(null)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [settings, setSettings] = useState<Setting[]>(DEFAULT_SETTINGS)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const token = await getToken()
      if (!token || cancelled) return
      const client = getAuthClient(token)

      const { data: me } = await client.from('users').select('id').maybeSingle()
      if (!me || cancelled) return
      userIdRef.current = (me as any).id

      const { data } = await client
        .from('notification_preferences')
        .select(Object.values(COLUMN).join(', '))
        .eq('user_id', (me as any).id)
        .maybeSingle()

      if (data && !cancelled) {
        setSettings((prev) =>
          prev.map((s) => {
            const column = COLUMN[s.id]
            const stored = (data as any)[column]
            return typeof stored === 'boolean' ? { ...s, value: stored } : s
          })
        )
      }
    })()
    return () => { cancelled = true }
  }, [])

  const savePrefs = (next: Setting[]) => {
    if (!userIdRef.current) return
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(async () => {
      const token = await getToken()
      if (!token) return
      const client = getAuthClient(token)
      const columns = Object.fromEntries(next.map((s) => [COLUMN[s.id], s.value]))
      await client
        .from('notification_preferences')
        .upsert({ user_id: userIdRef.current!, ...columns }, { onConflict: 'user_id' })
    }, 600)
  }

  const toggle = (id: string) => {
    setSettings((prev) => {
      const next = prev.map((s) => (s.id === id ? { ...s, value: !s.value } : s))
      savePrefs(next)
      return next
    })
  }

  const allEnabled = settings.every((s) => s.value)
  const toggleAll = () => {
    const next = !allEnabled
    setSettings((prev) => {
      const updated = prev.map((s) => ({ ...s, value: next }))
      savePrefs(updated)
      return updated
    })
  }

  const sections = [
    { label: 'Consultations', ids: ['new_request', 'messages', 'consultation_update'] },
    { label: 'Business', ids: ['earnings', 'reviews'] },
    { label: 'Account & More', ids: ['account', 'announcements'] },
  ]

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.6 }]} hitSlop={10}>
          <Ionicons name="chevron-back" size={26} color={colors.inkBlack} />
        </Pressable>
        <Text style={styles.headerTitle}>Notifications</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.masterCard}>
          <View style={styles.masterLeft}>
            <Ionicons name="notifications" size={22} color={colors.tealGreen} />
            <View>
              <Text style={styles.masterTitle}>All Notifications</Text>
              <Text style={styles.masterSub}>{allEnabled ? 'All enabled' : 'Some disabled'}</Text>
            </View>
          </View>
          <Switch
            value={allEnabled}
            onValueChange={toggleAll}
            trackColor={{ false: colors.steelGrey, true: `${colors.tealGreen}88` }}
            thumbColor={allEnabled ? colors.tealGreen : '#F3F4F6'}
          />
        </View>

        {sections.map((section) => {
          const sectionSettings = settings.filter((s) => section.ids.includes(s.id))
          return (
            <View key={section.label} style={styles.section}>
              <Text style={styles.sectionLabel}>{section.label}</Text>
              <View style={styles.card}>
                {sectionSettings.map((item, idx) => (
                  <View key={item.id}>
                    <View style={styles.row}>
                      <View style={[styles.iconWrap, { backgroundColor: `${item.iconColor}18` }]}>
                        <Ionicons name={item.icon as never} size={20} color={item.iconColor} />
                      </View>
                      <View style={styles.textWrap}>
                        <Text style={styles.rowTitle}>{item.title}</Text>
                        <Text style={styles.rowSub}>{item.subtitle}</Text>
                      </View>
                      <Switch
                        value={item.value}
                        onValueChange={() => toggle(item.id)}
                        trackColor={{ false: colors.steelGrey, true: `${colors.tealGreen}88` }}
                        thumbColor={item.value ? colors.tealGreen : '#F3F4F6'}
                      />
                    </View>
                    {idx < sectionSettings.length - 1 && <View style={styles.divider} />}
                  </View>
                ))}
              </View>
            </View>
          )
        })}

        <Text style={styles.note}>Push notification permissions are managed in your device settings.</Text>
        <View style={{ height: 32 }} />
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.cloudGrey },
  scroll: { flex: 1 },
  content: { paddingHorizontal: 20, paddingTop: 8 },

  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12 },
  backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontFamily: fonts.bold, fontSize: 18, color: colors.inkBlack },

  masterCard: { backgroundColor: colors.mistWhite, borderRadius: 16, padding: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24, ...shadow('#000', 0, 1, 6, 0.06, 2) },
  masterLeft: { flexDirection: 'row', alignItems: 'center', gap: 14, flex: 1 },
  masterTitle: { fontFamily: fonts.bold, fontSize: 15, color: colors.inkBlack },
  masterSub: { fontFamily: fonts.regular, fontSize: 12, color: '#6B7280', marginTop: 1 },

  section: { marginBottom: 20 },
  sectionLabel: { fontFamily: fonts.semiBold, fontSize: 12, color: '#6B7280', textTransform: 'uppercase', letterSpacing: 0.7, marginBottom: 10, marginLeft: 4 },
  card: { backgroundColor: colors.mistWhite, borderRadius: 16, overflow: 'hidden', ...shadow('#000', 0, 1, 5, 0.05, 2) },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, gap: 14 },
  iconWrap: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  textWrap: { flex: 1 },
  rowTitle: { fontFamily: fonts.semiBold, fontSize: 14, color: colors.inkBlack, marginBottom: 2 },
  rowSub: { fontFamily: fonts.regular, fontSize: 12, color: '#6B7280' },
  divider: { height: 1, backgroundColor: colors.cloudGrey, marginLeft: 68 },
  note: { fontFamily: fonts.regular, fontSize: 12, color: '#9CA3AF', textAlign: 'center', lineHeight: 18 },
})

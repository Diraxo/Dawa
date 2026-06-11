import { Ionicons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import { useState } from 'react'
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

// ─── Types ────────────────────────────────────────────────────────────────────

interface NotificationSetting {
  id: string
  icon: string
  iconColor: string
  title: string
  subtitle: string
  value: boolean
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function NotificationSettingsScreen() {
  const router = useRouter()

  const [settings, setSettings] = useState<NotificationSetting[]>([
    {
      id: 'consultation_request',
      icon: 'medkit-outline',
      iconColor: colors.tealGreen,
      title: 'Consultation Requests',
      subtitle: 'When a doctor accepts or declines',
      value: true,
    },
    {
      id: 'messages',
      icon: 'chatbubble-outline',
      iconColor: colors.interactiveBlue,
      title: 'New Messages',
      subtitle: 'In-app chat notifications',
      value: true,
    },
    {
      id: 'appointment_reminder',
      icon: 'calendar-outline',
      iconColor: colors.careBlue,
      title: 'Appointment Reminders',
      subtitle: '24 hours and 1 hour before',
      value: true,
    },
    {
      id: 'consultation_summary',
      icon: 'document-text-outline',
      iconColor: '#7C3AED',
      title: 'Consultation Summary',
      subtitle: 'When your doctor adds notes',
      value: true,
    },
    {
      id: 'promotions',
      icon: 'gift-outline',
      iconColor: colors.warning,
      title: 'Promotions & Offers',
      subtitle: 'Discounts and special offers',
      value: false,
    },
    {
      id: 'health_tips',
      icon: 'heart-outline',
      iconColor: colors.error,
      title: 'Health Tips',
      subtitle: 'Weekly wellness content',
      value: false,
    },
    {
      id: 'account',
      icon: 'shield-checkmark-outline',
      iconColor: colors.success,
      title: 'Account & Security',
      subtitle: 'Login alerts and policy updates',
      value: true,
    },
  ])

  const toggle = (id: string) => {
    setSettings((prev) =>
      prev.map((s) => (s.id === id ? { ...s, value: !s.value } : s))
    )
    // Production: persist to Supabase notifications table
    // await supabase.from('notification_preferences').upsert({ user_id, [id]: newValue })
  }

  const allEnabled = settings.every((s) => s.value)
  const toggleAll = () => {
    const next = !allEnabled
    setSettings((prev) => prev.map((s) => ({ ...s, value: next })))
  }

  const sections = [
    {
      label: 'Consultations',
      ids: ['consultation_request', 'messages', 'appointment_reminder', 'consultation_summary'],
    },
    {
      label: 'Content & Marketing',
      ids: ['promotions', 'health_tips'],
    },
    {
      label: 'Security',
      ids: ['account'],
    },
  ]

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Pressable
          onPress={() => router.back()}
          style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.6 }]}
          hitSlop={10}
        >
          <Ionicons name="chevron-back" size={26} color={colors.inkBlack} />
        </Pressable>
        <Text style={styles.headerTitle}>Notifications</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {/* Master toggle */}
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

        {/* Sections */}
        {sections.map((section) => {
          const sectionSettings = settings.filter((s) => section.ids.includes(s.id))
          return (
            <View key={section.label} style={styles.section}>
              <Text style={styles.sectionLabel}>{section.label}</Text>
              <View style={styles.card}>
                {sectionSettings.map((item, idx) => (
                  <View key={item.id}>
                    <View style={styles.row}>
                      <View
                        style={[styles.iconWrap, { backgroundColor: `${item.iconColor}18` }]}
                      >
                        <Ionicons
                          name={item.icon as React.ComponentProps<typeof Ionicons>['name']}
                          size={20}
                          color={item.iconColor}
                        />
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

        <Text style={styles.note}>
          Push notification permissions are managed in your device settings.
        </Text>

        <View style={{ height: 32 }} />
      </ScrollView>
    </SafeAreaView>
  )
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.cloudGrey },
  scroll: { flex: 1 },
  content: { paddingHorizontal: 20, paddingTop: 8 },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontFamily: fonts.bold, fontSize: 18, color: colors.inkBlack },

  masterCard: {
    backgroundColor: colors.mistWhite,
    borderRadius: 16,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 2,
  },
  masterLeft: { flexDirection: 'row', alignItems: 'center', gap: 14, flex: 1 },
  masterTitle: { fontFamily: fonts.bold, fontSize: 15, color: colors.inkBlack },
  masterSub: { fontFamily: fonts.regular, fontSize: 12, color: '#6B7280', marginTop: 1 },

  section: { marginBottom: 20 },
  sectionLabel: {
    fontFamily: fonts.semiBold,
    fontSize: 12,
    color: '#6B7280',
    textTransform: 'uppercase',
    letterSpacing: 0.7,
    marginBottom: 10,
    marginLeft: 4,
  },
  card: {
    backgroundColor: colors.mistWhite,
    borderRadius: 16,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 5,
    elevation: 2,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 14,
  },
  iconWrap: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textWrap: { flex: 1 },
  rowTitle: { fontFamily: fonts.semiBold, fontSize: 14, color: colors.inkBlack, marginBottom: 2 },
  rowSub: { fontFamily: fonts.regular, fontSize: 12, color: '#6B7280' },
  divider: { height: 1, backgroundColor: colors.cloudGrey, marginLeft: 68 },

  note: {
    fontFamily: fonts.regular,
    fontSize: 12,
    color: '#9CA3AF',
    textAlign: 'center',
    lineHeight: 18,
  },
})

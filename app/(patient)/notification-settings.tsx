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
import { useTranslation } from 'react-i18next'

import { colors } from '@/constants/colors'
import { fonts } from '@/constants/fonts'
import { shadow } from '@/lib/shadow'
import { getAuthClient } from '@/lib/supabase'

type PrefKey =
  | 'consultation_request'
  | 'messages'
  | 'appointment_reminder'
  | 'consultation_summary'
  | 'promotions'
  | 'health_tips'
  | 'account'

const DEFAULTS: Record<PrefKey, boolean> = {
  consultation_request: true,
  messages: true,
  appointment_reminder: true,
  consultation_summary: true,
  promotions: false,
  health_tips: false,
  account: true,
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function NotificationSettingsScreen() {
  const router = useRouter()
  const { t } = useTranslation()
  const { getToken } = useAuth()
  const userIdRef = useRef<string | null>(null)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [toggles, setToggles] = useState<Record<PrefKey, boolean>>(DEFAULTS)
  const [loaded, setLoaded] = useState(false)

  // Load from Supabase on mount
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const token = await getToken()
      if (!token || cancelled) return
      const client = getAuthClient(token)

      const { data: me } = await client
        .from('users')
        .select('id')
        .maybeSingle()
      if (!me || cancelled) return
      userIdRef.current = (me as any).id

      const { data } = await client
        .from('notification_preferences')
        .select('consultation_request, messages, appointment_reminder, consultation_summary, promotions, health_tips, account')
        .eq('user_id', (me as any).id)
        .maybeSingle()

      if (data && !cancelled) {
        setToggles({
          consultation_request: (data as any).consultation_request ?? DEFAULTS.consultation_request,
          messages: (data as any).messages ?? DEFAULTS.messages,
          appointment_reminder: (data as any).appointment_reminder ?? DEFAULTS.appointment_reminder,
          consultation_summary: (data as any).consultation_summary ?? DEFAULTS.consultation_summary,
          promotions: (data as any).promotions ?? DEFAULTS.promotions,
          health_tips: (data as any).health_tips ?? DEFAULTS.health_tips,
          account: (data as any).account ?? DEFAULTS.account,
        })
      }
      if (!cancelled) setLoaded(true)
    })()
    return () => { cancelled = true }
  }, [])

  // Debounced save to Supabase
  const savePrefs = (next: Record<PrefKey, boolean>) => {
    if (!userIdRef.current) return
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(async () => {
      const token = await getToken()
      if (!token) return
      const client = getAuthClient(token)
      await client
        .from('notification_preferences')
        .upsert({ user_id: userIdRef.current!, ...next }, { onConflict: 'user_id' })
    }, 600)
  }

  const settingsMeta: { id: PrefKey; icon: string; iconColor: string; title: string; subtitle: string }[] = [
    { id: 'consultation_request', icon: 'medkit-outline',           iconColor: colors.tealGreen,       title: t('consultationRequests'),    subtitle: t('consultationRequestsSub') },
    { id: 'messages',             icon: 'chatbubble-outline',        iconColor: colors.interactiveBlue, title: t('newMessages'),             subtitle: t('newMessagesSub') },
    { id: 'appointment_reminder', icon: 'calendar-outline',          iconColor: colors.careBlue,        title: t('appointmentReminders'),    subtitle: t('appointmentRemindersSub') },
    { id: 'consultation_summary', icon: 'document-text-outline',     iconColor: '#7C3AED',              title: t('consultationSummaryNotif'),subtitle: t('consultationSummaryNotifSub') },
    { id: 'promotions',           icon: 'gift-outline',              iconColor: colors.warning,         title: t('promotionsOffers'),        subtitle: t('promotionsOffersSub') },
    { id: 'health_tips',          icon: 'heart-outline',             iconColor: colors.error,           title: t('healthTips'),              subtitle: t('healthTipsSub') },
    { id: 'account',              icon: 'shield-checkmark-outline',  iconColor: colors.success,         title: t('accountSecurity'),         subtitle: t('accountSecuritySub') },
  ]

  const settings = settingsMeta.map((m) => ({ ...m, value: toggles[m.id] ?? false }))

  const sections = [
    { label: t('consultationsSection'), ids: ['consultation_request', 'messages', 'appointment_reminder', 'consultation_summary'] },
    { label: t('contentMarketing'),     ids: ['promotions', 'health_tips'] },
    { label: t('security'),             ids: ['account'] },
  ]

  const toggle = (id: string) => {
    setToggles((prev) => {
      const next = { ...prev, [id]: !prev[id] } as Record<PrefKey, boolean>
      savePrefs(next)
      return next
    })
  }

  const allEnabled = Object.values(toggles).every(Boolean)
  const toggleAll = () => {
    const enabled = !allEnabled
    setToggles((prev) => {
      const next = Object.fromEntries(Object.keys(prev).map((k) => [k, enabled])) as Record<PrefKey, boolean>
      savePrefs(next)
      return next
    })
  }

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
        <Text style={styles.headerTitle}>{t('notifications')}</Text>
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
              <Text style={styles.masterTitle}>{t('allNotifications')}</Text>
              <Text style={styles.masterSub}>{allEnabled ? t('allEnabled') : t('someDisabled')}</Text>
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

        <Text style={styles.note}>{t('notifDeviceSettingsNote')}</Text>

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
    ...shadow('#000', 0, 1, 6, 0.06, 2),
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
    ...shadow('#000', 0, 1, 5, 0.05, 2),
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

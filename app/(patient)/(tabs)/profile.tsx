import { Ionicons } from '@expo/vector-icons'
import { useAuth, useUser } from '@clerk/clerk-expo'
import { LinearGradient } from 'expo-linear-gradient'
import { useRouter } from 'expo-router'
import { Image } from 'expo-image'
import { useState } from 'react'
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { DawaAlert } from '@/components/ui/DawaAlert'
import { colors } from '@/constants/colors'
import { fonts } from '@/constants/fonts'
import { gradients } from '@/constants/gradients'
import Constants from 'expo-constants'
import { useNavGuard } from '@/hooks/useNavGuard'
import { useOwnProfilePhoto } from '@/hooks/useOwnProfilePhoto'
import { clearPushTokens } from '@/lib/pushTokens'
import { shadow } from '@/lib/shadow'
import { pushOwnNameToStream, pushOwnPhotoToStream } from '@/lib/stream'
import { getAuthClient, supabaseEmailAuth } from '@/lib/supabase'
import { useAppStore } from '@/store/appStore'
import { useAuthStore } from '@/store/authStore'
import { useTranslation } from 'react-i18next'

const LANGUAGE_DISPLAY: Record<string, string> = {
  en: 'English', so: 'Soomaali', am: 'አማርኛ',
  om: 'Afaan Oromoo', ti: 'ትግርኛ', ar: 'العربية',
}

const APP_VERSION = Constants.expoConfig?.version ?? '1.0.0'

// ─── Types ────────────────────────────────────────────────────────────────────

interface MenuItem {
  icon: string
  label: string
  subtitle: string
  onPress: () => void
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function ProfileScreen() {
  const { t } = useTranslation()
  const { user } = useUser()
  const { signOut, getToken } = useAuth()
  const router = useRouter()
  const { selectedLanguage } = useAppStore()
  const { clearAuth, disconnectStream } = useAuthStore()
  const guardNav = useNavGuard()
  const guardLogout = useNavGuard()
  const fullName =
    (user?.fullName ??
      `${user?.firstName ?? ''} ${user?.lastName ?? ''}`.trim()) ||
    'Your Name'
  const email = user?.primaryEmailAddress?.emailAddress ?? ''
  const initial = (user?.firstName?.[0] ?? user?.fullName?.[0] ?? 'U').toUpperCase()

  const [showLogoutAlert, setShowLogoutAlert] = useState(false)
  const [showDeactivateAlert, setShowDeactivateAlert] = useState(false)
  const [showDeleteAlert, setShowDeleteAlert] = useState(false)
  const [showDeleteConfirmAlert, setShowDeleteConfirmAlert] = useState(false)
  const [showDeleteErrorAlert, setShowDeleteErrorAlert] = useState(false)

  // Photo is uploaded to Supabase Storage (edit-personal-info), not Clerk —
  // read the DB value so a custom-uploaded photo actually shows here, falling
  // back to Clerk's imageUrl only when the DB has none. Stays live via
  // Realtime so an edit made elsewhere (or on another device) shows up
  // without needing to leave and revisit this tab.
  const { photoUrl: dbPhotoUrl } = useOwnProfilePhoto()

  const avatarUri = dbPhotoUrl ?? user?.imageUrl ?? null

  // ── Handlers ─────────────────────────────────────────────────────────────────

  const handleLogout = () => setShowLogoutAlert(true)

  const handleDeactivate = () => setShowDeactivateAlert(true)

  const handleDeleteAccount = () => setShowDeleteAlert(true)

  const confirmDeactivate = async () => {
    setShowDeactivateAlert(false)
    if (user?.id) await clearPushTokens(user.id)
    await disconnectStream()
    await supabaseEmailAuth.auth.signOut()
    clearAuth()
    await signOut()
    router.replace('/(auth)/sign-in')
  }

  const confirmDelete = () => {
    setShowDeleteAlert(false)
    setShowDeleteConfirmAlert(true)
  }

  const permanentlyDelete = async () => {
    setShowDeleteConfirmAlert(false)
    try {
      const token = user?.id ? await getToken().catch(() => null) : null
      if (user?.id && token) {
        const client = getAuthClient(token)
        // Best-effort avatar cleanup — must never block account deletion.
        await client.storage.from('profile-photos').remove([`${user.id}/avatar.jpg`]).catch(() => {})

        // Anonymize rather than hard-delete the `users` row: consultations,
        // messages, and reviews all reference patient_id/sender_id with
        // ON DELETE NO ACTION, so a hard delete throws a foreign-key
        // violation for any patient who has ever sent a message or had a
        // consultation — i.e. this used to fail silently for real users.
        // Scrubbing personal fields satisfies "delete my account" while
        // leaving the consultation records intact (as our Privacy Policy's
        // Data Retention section already promises for medical compliance).
        const anonEmail = `deleted-${user.id}@dawa.invalid`
        // Explicit .eq('clerk_id', ...) below is defense-in-depth, not the
        // only thing scoping this update to the caller's own row — RLS
        // (users_update_own) already restricts it — but a bare .update()
        // with no filter at all relies entirely on RLS staying correct
        // forever with zero client-side backstop, which is exactly the kind
        // of "could touch more than one row" risk worth closing off here.
        // Must throw on failure rather than continue silently — a failed
        // update here would otherwise go unnoticed and the Clerk account
        // below would still get deleted, permanently orphaning this row
        // under the real email/name and locking that email out of ever
        // signing up again (see app/(auth)/role.tsx's isEmailConflict path).
        const { data: anonUserRow, error: anonUserError } = await client
          .from('users')
          .update({
            full_name: 'Deleted Patient',
            email: anonEmail,
            phone: null,
            profile_photo_url: null,
            push_token: null,
            fcm_token: null,
            voip_token: null,
            address: null,
            is_suspended: true,
          })
          .eq('clerk_id', user.id)
          .select('id')
          .single()
        if (anonUserError) throw anonUserError
        const { error: anonProfileError } = await client
          .from('patient_profiles')
          .update({ date_of_birth: null, gender: null })
          .eq('user_id', anonUserRow.id)
        if (anonProfileError) throw anonProfileError

        // Stream only learns a user's name/photo at connectUser() time, so
        // without pushing the anonymized values explicitly, any doctor with
        // an existing chat thread would keep seeing this patient's real name
        // and photo indefinitely after "deletion".
        await pushOwnNameToStream('Deleted Patient')
        await pushOwnPhotoToStream(null)
      }
      await supabaseEmailAuth.auth.signOut()
      await user?.delete()
      await disconnectStream()
      clearAuth()
      await signOut()
      router.replace('/(auth)/sign-up')
    } catch {
      setShowDeleteErrorAlert(true)
    }
  }

  // ── Menu definition ───────────────────────────────────────────────────────────

  const menuItems: MenuItem[] = [
    {
      icon: 'person-outline',
      label: t('personalInformation'),
      subtitle: t('updateAccountDetails'),
      onPress: () => router.push('/(patient)/edit-personal-info'),
    },
    {
      icon: 'fitness-outline',
      label: t('medicalRecords'),
      subtitle: t('viewHistoryDocs'),
      onPress: () => router.push('/(patient)/medical-records'),
    },
    {
      icon: 'download-outline',
      label: 'Export My Data',
      subtitle: 'Download consultation history & records',
      onPress: () => router.push('/(patient)/data-export'),
    },
    {
      icon: 'card-outline',
      label: t('paymentMethods'),
      subtitle: t('managePaymentInfo'),
      onPress: () => router.push('/(patient)/payment-methods'),
    },
    {
      icon: 'time-outline',
      label: t('notificationHistory', { defaultValue: 'Notification History' }),
      subtitle: t('notificationHistorySub', { defaultValue: 'View past alerts and updates' }),
      onPress: () => router.push('/(patient)/notifications' as never),
    },
    {
      icon: 'notifications-outline',
      label: t('notifications'),
      subtitle: t('configureAlerts'),
      onPress: () => router.push('/(patient)/notification-settings'),
    },
    {
      icon: 'globe-outline',
      label: t('language'),
      subtitle: LANGUAGE_DISPLAY[selectedLanguage ?? 'en'] ?? 'English',
      onPress: () => router.push('/(patient)/language-settings'),
    },
    {
      icon: 'help-circle-outline',
      label: t('helpSupport'),
      subtitle: t('faqsContact'),
      onPress: () => router.push('/(patient)/help-support'),
    },
    {
      icon: 'information-circle-outline',
      label: t('aboutDawa'),
      subtitle: t('ourMissionStory'),
      onPress: () => router.push('/(patient)/about-dawa'),
    },
  ]

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <>
      <DawaAlert
        visible={showLogoutAlert}
        variant="logout"
        title="Log Out"
        message="Are you sure you want to log out of your Dawa account?"
        buttons={[
          { text: 'Cancel', style: 'outline', onPress: () => setShowLogoutAlert(false) },
          {
            text: 'Log Out',
            style: 'danger',
            onPress: guardLogout(async () => {
              setShowLogoutAlert(false)
              if (user?.id) await clearPushTokens(user.id)
              await disconnectStream()
              await supabaseEmailAuth.auth.signOut()
              clearAuth()
              await signOut()
              router.replace('/(auth)/sign-in')
            }),
          },
        ]}
        onClose={() => setShowLogoutAlert(false)}
      />
      <DawaAlert
        visible={showDeactivateAlert}
        variant="warning"
        title="Deactivate Account"
        message="You will be signed out on this device. Your account and data stay intact — to fully deactivate or reactivate your account, contact support at dawasupport@gmail.com."
        buttons={[
          { text: 'Cancel', style: 'outline', onPress: () => setShowDeactivateAlert(false) },
          { text: 'Deactivate', style: 'danger', onPress: confirmDeactivate },
        ]}
        onClose={() => setShowDeactivateAlert(false)}
      />
      <DawaAlert
        visible={showDeleteAlert}
        variant="error"
        title="Delete Account"
        message="This will permanently remove your personal information (name, email, phone, profile photo) and sign you out of Dawa. This cannot be undone."
        buttons={[
          { text: 'Cancel', style: 'outline', onPress: () => setShowDeleteAlert(false) },
          { text: 'Delete', style: 'danger', onPress: confirmDelete },
        ]}
        onClose={() => setShowDeleteAlert(false)}
      />
      <DawaAlert
        visible={showDeleteConfirmAlert}
        variant="error"
        title="Final Confirmation"
        message="Your personal information will be permanently removed and cannot be recovered. Your past consultation records are kept for medical record-keeping, as described in our Privacy Policy. Are you absolutely sure?"
        buttons={[
          { text: 'Cancel', style: 'outline', onPress: () => setShowDeleteConfirmAlert(false) },
          { text: 'Permanently Delete', style: 'danger', onPress: permanentlyDelete },
        ]}
        onClose={() => setShowDeleteConfirmAlert(false)}
      />
      <DawaAlert
        visible={showDeleteErrorAlert}
        variant="error"
        title="Unable to Delete"
        message="We couldn't delete your account. Please contact support at dawasupport@gmail.com"
        buttons={[
          { text: 'OK', style: 'primary', onPress: () => setShowDeleteErrorAlert(false) },
        ]}
        onClose={() => setShowDeleteErrorAlert(false)}
      />
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {/* Page title */}
        <Text style={styles.pageTitle}>{t('profile')}</Text>

        {/* ── Profile hero card ── */}
        <LinearGradient
          colors={gradients.hero}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={styles.profileCard}
        >
          <Pressable
            style={styles.avatarWrap}
            onPress={() => router.push('/(patient)/edit-personal-info')}
          >
            {avatarUri ? (
              <Image
                source={{ uri: avatarUri }}
                style={styles.avatar}
                contentFit="cover"
                cachePolicy="memory-disk"
                transition={0}
              />
            ) : (
              <View style={styles.avatarFallback}>
                <Text style={styles.avatarInitial}>{initial}</Text>
              </View>
            )}
            <View style={styles.cameraBtn}>
              <Ionicons name="camera" size={13} color={colors.mistWhite} />
            </View>
          </Pressable>

          <View style={styles.profileInfo}>
            <Text style={styles.profileName} numberOfLines={1}>
              {fullName}
            </Text>
            <Text style={styles.profileEmail} numberOfLines={1}>
              {email}
            </Text>
            <View style={styles.patientBadge}>
              <Ionicons
                name="shield-checkmark"
                size={11}
                color="rgba(255,255,255,0.9)"
              />
              <Text style={styles.patientBadgeText}>{t('verifiedPatient')}</Text>
            </View>
          </View>
        </LinearGradient>

        {/* ── Edit Personal Info button ── */}
        <Pressable
          style={({ pressed }) => [styles.editBtnWrap, pressed && { opacity: 0.88 }]}
          onPress={() => router.push('/(patient)/edit-personal-info')}
        >
          <LinearGradient
            colors={gradients.interactive}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.editBtnGradient}
          >
            <Ionicons name="pencil" size={17} color={colors.mistWhite} />
            <Text style={styles.editBtnText}>{t('editPersonalInfo')}</Text>
          </LinearGradient>
        </Pressable>

        {/* ── Settings menu ── */}
        <View style={styles.menuCard}>
          {menuItems.map((item, idx) => (
            <View key={item.label}>
              <Pressable
                style={({ pressed }) => [
                  styles.menuItem,
                  pressed && { backgroundColor: '#F9FAFB' },
                ]}
                onPress={guardNav(item.onPress)}
              >
                <View style={styles.menuIconWrap}>
                  <Ionicons
                    name={item.icon as React.ComponentProps<typeof Ionicons>['name']}
                    size={21}
                    color={colors.tealGreen}
                  />
                </View>
                <View style={styles.menuTextWrap}>
                  <Text style={styles.menuLabel}>{item.label}</Text>
                  <Text style={styles.menuSub}>{item.subtitle}</Text>
                </View>
                <Ionicons name="chevron-forward" size={17} color={colors.steelGrey} />
              </Pressable>
              {idx < menuItems.length - 1 && <View style={styles.divider} />}
            </View>
          ))}
        </View>

        {/* ── Deactivate Account ── */}
        <Pressable
          style={({ pressed }) => [styles.deactivateBtn, pressed && { opacity: 0.8 }]}
          onPress={handleDeactivate}
        >
          <Ionicons name="pause-circle-outline" size={19} color={colors.warning} />
          <Text style={styles.deactivateBtnText}>{t('deactivateAccount')}</Text>
        </Pressable>

        {/* ── Delete Account ── */}
        <Pressable
          style={({ pressed }) => [styles.deleteBtn, pressed && { opacity: 0.8 }]}
          onPress={handleDeleteAccount}
        >
          <Ionicons name="trash-outline" size={19} color={colors.error} />
          <Text style={styles.deleteBtnText}>{t('deleteAccount')}</Text>
        </Pressable>

        {/* ── Logout ── */}
        <Pressable
          style={({ pressed }) => [styles.logoutBtn, pressed && { opacity: 0.7 }]}
          onPress={handleLogout}
        >
          <Ionicons name="log-out-outline" size={19} color="#6B7280" />
          <Text style={styles.logoutText}>{t('logOut')}</Text>
        </Pressable>

        {/* ── Version footer ── */}
        <Text style={styles.version}>Dawa v{APP_VERSION}</Text>

        <View style={styles.bottomPad} />
      </ScrollView>
    </SafeAreaView>
    </>
  )
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.cloudGrey },
  scroll: { flex: 1 },
  content: { paddingHorizontal: 20, paddingTop: 10 },

  pageTitle: {
    fontFamily: fonts.bold,
    fontSize: 28,
    color: colors.inkBlack,
    marginBottom: 20,
  },

  // Profile card
  profileCard: {
    borderRadius: 20,
    padding: 20,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    marginBottom: 14,
    ...shadow(colors.careBlue, 0, 4, 12, 0.25, 5),
  },
  avatarWrap: { position: 'relative' },
  avatar: { width: 66, height: 66, borderRadius: 33, borderWidth: 2, borderColor: 'rgba(255,255,255,0.4)' },
  avatarFallback: {
    width: 66,
    height: 66,
    borderRadius: 33,
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: {
    fontFamily: fonts.bold,
    fontSize: 26,
    color: colors.mistWhite,
  },
  cameraBtn: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.6)',
  },
  profileInfo: { flex: 1 },
  profileName: {
    fontFamily: fonts.bold,
    fontSize: 18,
    color: colors.mistWhite,
    marginBottom: 2,
  },
  profileEmail: {
    fontFamily: fonts.regular,
    fontSize: 13,
    color: 'rgba(255,255,255,0.85)',
    marginBottom: 8,
  },
  patientBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
  },
  patientBadgeText: {
    fontFamily: fonts.semiBold,
    fontSize: 11,
    color: 'rgba(255,255,255,0.95)',
  },

  // Edit button
  editBtnWrap: { borderRadius: 16, overflow: 'hidden', marginBottom: 24 },
  editBtnGradient: {
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  editBtnText: {
    fontFamily: fonts.bold,
    fontSize: 16,
    color: colors.mistWhite,
  },

  // Menu card
  menuCard: {
    backgroundColor: colors.mistWhite,
    borderRadius: 16,
    marginBottom: 14,
    ...shadow('#000', 0, 1, 6, 0.06, 2),
    overflow: 'hidden',
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 14,
  },
  menuIconWrap: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: '#F0FDFB',
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuTextWrap: { flex: 1 },
  menuLabel: {
    fontFamily: fonts.semiBold,
    fontSize: 15,
    color: colors.inkBlack,
    marginBottom: 2,
  },
  menuSub: {
    fontFamily: fonts.regular,
    fontSize: 12,
    color: '#6B7280',
  },
  divider: {
    height: 1,
    backgroundColor: colors.cloudGrey,
    marginLeft: 68,
  },

  // Delete / Logout
  deactivateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 52,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: colors.warning,
    backgroundColor: colors.mistWhite,
    marginBottom: 12,
    ...shadow('#000', 0, 1, 4, 0.04, 1),
  },
  deactivateBtnText: {
    fontFamily: fonts.semiBold,
    fontSize: 15,
    color: colors.warning,
  },
  deleteBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 52,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: colors.error,
    backgroundColor: colors.mistWhite,
    marginBottom: 12,
    ...shadow('#000', 0, 1, 4, 0.04, 1),
  },
  deleteBtnText: {
    fontFamily: fonts.semiBold,
    fontSize: 15,
    color: colors.error,
  },
  logoutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 14,
  },
  logoutText: {
    fontFamily: fonts.semiBold,
    fontSize: 15,
    color: '#6B7280',
  },

  version: {
    fontFamily: fonts.regular,
    fontSize: 12,
    color: '#9CA3AF',
    textAlign: 'center',
    marginTop: 4,
  },
  bottomPad: { height: 24 },
})

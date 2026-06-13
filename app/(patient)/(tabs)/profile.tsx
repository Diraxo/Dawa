import { Ionicons } from '@expo/vector-icons'
import { useAuth, useUser } from '@clerk/clerk-expo'
import { LinearGradient } from 'expo-linear-gradient'
import { useRouter } from 'expo-router'
import { useState } from 'react'
import {
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { CareHubAlert } from '@/components/ui/CareHubAlert'
import { colors } from '@/constants/colors'
import { fonts } from '@/constants/fonts'
import { gradients } from '@/constants/gradients'
import Constants from 'expo-constants'
import { supabase, supabaseEmailAuth } from '@/lib/supabase'
import { useAppStore } from '@/store/appStore'
import { useAuthStore } from '@/store/authStore'

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
  const { user } = useUser()
  const { signOut } = useAuth()
  const router = useRouter()
  const { selectedLanguage } = useAppStore()
  const { clearAuth, disconnectStream } = useAuthStore()
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

  // ── Handlers ─────────────────────────────────────────────────────────────────

  const handleLogout = () => setShowLogoutAlert(true)

  const handleDeactivate = () => setShowDeactivateAlert(true)

  const handleDeleteAccount = () => setShowDeleteAlert(true)

  const confirmDeactivate = async () => {
    setShowDeactivateAlert(false)
    await supabase.from('users').update({ is_active: false }).eq('clerk_id', user?.id)
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
      await supabase.from('users').delete().eq('clerk_id', user?.id)
      await user?.delete()
      router.replace('/(auth)/sign-up')
    } catch {
      setShowDeleteErrorAlert(true)
    }
  }

  // ── Menu definition ───────────────────────────────────────────────────────────

  const menuItems: MenuItem[] = [
    {
      icon: 'person-outline',
      label: 'Personal Information',
      subtitle: 'Update your account details',
      onPress: () => router.push('/(patient)/edit-personal-info'),
    },
    {
      icon: 'fitness-outline',
      label: 'Medical Records',
      subtitle: 'View history & documents',
      onPress: () => router.push('/(patient)/medical-records'),
    },
    {
      icon: 'card-outline',
      label: 'Payment Methods',
      subtitle: 'Manage saved payment info (Placeholder)',
      onPress: () => router.push('/(patient)/payment-methods'),
    },
    {
      icon: 'notifications-outline',
      label: 'Notifications',
      subtitle: 'Configure app alerts',
      onPress: () => router.push('/(patient)/notification-settings'),
    },
    {
      icon: 'globe-outline',
      label: 'Language',
      subtitle: LANGUAGE_DISPLAY[selectedLanguage ?? 'en'] ?? 'English',
      onPress: () => router.push('/(patient)/language-settings'),
    },
    {
      icon: 'help-circle-outline',
      label: 'Help & Support',
      subtitle: 'FAQs & Contact Us',
      onPress: () => router.push('/(patient)/help-support'),
    },
    {
      icon: 'information-circle-outline',
      label: 'About CareHub',
      subtitle: 'Our mission & story',
      onPress: () => router.push('/(patient)/about-carehub'),
    },
  ]

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <>
      <CareHubAlert
        visible={showLogoutAlert}
        variant="logout"
        title="Log Out"
        message="Are you sure you want to log out of your CareHub account?"
        buttons={[
          { text: 'Cancel', style: 'outline', onPress: () => setShowLogoutAlert(false) },
          {
            text: 'Log Out',
            style: 'danger',
            onPress: async () => {
              setShowLogoutAlert(false)
              await disconnectStream()
              await supabaseEmailAuth.auth.signOut()
              clearAuth()
              await signOut()
              router.replace('/(auth)/sign-in')
            },
          },
        ]}
        onClose={() => setShowLogoutAlert(false)}
      />
      <CareHubAlert
        visible={showDeactivateAlert}
        variant="warning"
        title="Deactivate Account"
        message="Your account will be deactivated and you will be logged out. You can reactivate by contacting support."
        buttons={[
          { text: 'Cancel', style: 'outline', onPress: () => setShowDeactivateAlert(false) },
          { text: 'Deactivate', style: 'danger', onPress: confirmDeactivate },
        ]}
        onClose={() => setShowDeactivateAlert(false)}
      />
      <CareHubAlert
        visible={showDeleteAlert}
        variant="error"
        title="Delete Account"
        message="This will permanently delete your account and all your data. This cannot be undone."
        buttons={[
          { text: 'Cancel', style: 'outline', onPress: () => setShowDeleteAlert(false) },
          { text: 'Delete', style: 'danger', onPress: confirmDelete },
        ]}
        onClose={() => setShowDeleteAlert(false)}
      />
      <CareHubAlert
        visible={showDeleteConfirmAlert}
        variant="error"
        title="Final Confirmation"
        message="All your consultations, medical records, and account data will be permanently removed. Are you absolutely sure?"
        buttons={[
          { text: 'Cancel', style: 'outline', onPress: () => setShowDeleteConfirmAlert(false) },
          { text: 'Permanently Delete', style: 'danger', onPress: permanentlyDelete },
        ]}
        onClose={() => setShowDeleteConfirmAlert(false)}
      />
      <CareHubAlert
        visible={showDeleteErrorAlert}
        variant="error"
        title="Unable to Delete"
        message="We couldn't delete your account. Please contact support at support@carehub.app"
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
        <Text style={styles.pageTitle}>Profile</Text>

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
            {user?.imageUrl ? (
              <Image source={{ uri: user.imageUrl }} style={styles.avatar} />
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
              <Text style={styles.patientBadgeText}>Verified Patient</Text>
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
            <Text style={styles.editBtnText}>Edit Personal Info</Text>
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
                onPress={item.onPress}
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
          <Text style={styles.deactivateBtnText}>Deactivate Account</Text>
        </Pressable>

        {/* ── Delete Account ── */}
        <Pressable
          style={({ pressed }) => [styles.deleteBtn, pressed && { opacity: 0.8 }]}
          onPress={handleDeleteAccount}
        >
          <Ionicons name="trash-outline" size={19} color={colors.error} />
          <Text style={styles.deleteBtnText}>Delete Account</Text>
        </Pressable>

        {/* ── Logout ── */}
        <Pressable
          style={({ pressed }) => [styles.logoutBtn, pressed && { opacity: 0.7 }]}
          onPress={handleLogout}
        >
          <Ionicons name="log-out-outline" size={19} color="#6B7280" />
          <Text style={styles.logoutText}>Logout</Text>
        </Pressable>

        {/* ── Version footer ── */}
        <Text style={styles.version}>CareHub v{APP_VERSION}</Text>

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
    shadowColor: colors.careBlue,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 12,
    elevation: 5,
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
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 2,
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
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
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
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
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

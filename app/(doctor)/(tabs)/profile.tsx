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
import { useDoctorStore } from '@/store/doctorStore'
import { supabaseEmailAuth } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'

// ─── Menu row component ───────────────────────────────────────────────────────

function MenuRow({
  icon,
  label,
  subtitle,
  onPress,
  danger,
}: {
  icon: string
  label: string
  subtitle?: string
  onPress: () => void
  danger?: boolean
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.menuRow, pressed && { opacity: 0.7 }]}
    >
      <View style={[styles.menuIconWrap, danger && styles.menuIconWrapDanger]}>
        <Ionicons name={icon as never} size={20} color={danger ? colors.error : colors.careBlue} />
      </View>
      <View style={styles.menuTextWrap}>
        <Text style={[styles.menuLabel, danger && styles.menuLabelDanger]}>{label}</Text>
        {subtitle && <Text style={styles.menuSubtitle}>{subtitle}</Text>}
      </View>
      {!danger && <Ionicons name="chevron-forward" size={16} color="#9CA3AF" />}
    </Pressable>
  )
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function DoctorProfileScreen() {
  const { user } = useUser()
  const { signOut } = useAuth()
  const router = useRouter()
  const { regSpecialty, regHospitalName } = useDoctorStore()
  const { clearAuth, disconnectStream } = useAuthStore()

  const fullName = user?.fullName ?? `Dr. ${user?.firstName ?? ''} ${user?.lastName ?? ''}`.trim()
  const initial = (user?.firstName?.[0] ?? fullName[0] ?? 'D').toUpperCase()
  const specialty = regSpecialty || 'General Practice'
  const hospital = regHospitalName || 'Hospital'

  const [showLogoutAlert, setShowLogoutAlert] = useState(false)
  const [showComingSoonAlert, setShowComingSoonAlert] = useState(false)

  const handleLogout = () => setShowLogoutAlert(true)

  const showComingSoon = () => setShowComingSoonAlert(true)

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
        visible={showComingSoonAlert}
        variant="info"
        title="Coming Soon"
        message="This feature is coming soon. We're working hard to bring it to you!"
        buttons={[
          { text: 'Got it', style: 'primary', onPress: () => setShowComingSoonAlert(false) },
        ]}
        onClose={() => setShowComingSoonAlert(false)}
      />
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        {/* ── Profile Header ── */}
        <LinearGradient colors={gradients.hero} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.profileHeader}>
          <Pressable onPress={showComingSoon} style={styles.photoWrap}>
            {user?.imageUrl ? (
              <Image source={{ uri: user.imageUrl }} style={styles.photo} />
            ) : (
              <View style={styles.photoFallback}>
                <Text style={styles.photoInitial}>{initial}</Text>
              </View>
            )}
            <View style={styles.editBadge}>
              <Ionicons name="camera" size={14} color={colors.mistWhite} />
            </View>
          </Pressable>
          <Text style={styles.profileName}>{fullName}</Text>
          <Text style={styles.profileSpecialty}>{specialty} · {hospital}</Text>

          {/* Stats row */}
          <View style={styles.statsRow}>
            <View style={styles.statItem}>
              <Text style={styles.statValue}>⭐ 4.9</Text>
              <Text style={styles.statLabel}>Rating</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statItem}>
              <Text style={styles.statValue}>247</Text>
              <Text style={styles.statLabel}>Consultations</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statItem}>
              <View style={styles.onlineBadge}>
                <View style={styles.onlineDot} />
                <Text style={styles.statValue}>Online</Text>
              </View>
              <Text style={styles.statLabel}>Status</Text>
            </View>
          </View>
        </LinearGradient>

        {/* ── Account Section ── */}
        <Text style={styles.sectionTitle}>Account</Text>
        <View style={styles.menuCard}>
          <MenuRow icon="person-outline" label="Edit Profile" subtitle="Name, bio, photo, hospital" onPress={showComingSoon} />
          <View style={styles.menuDivider} />
          <MenuRow icon="pricetag-outline" label="My Pricing" subtitle="Chat, phone, and video prices" onPress={showComingSoon} />
          <View style={styles.menuDivider} />
          <MenuRow icon="medical-outline" label="My Specialties & Tags" onPress={showComingSoon} />
        </View>

        {/* ── Work Section ── */}
        <Text style={styles.sectionTitle}>Work</Text>
        <View style={styles.menuCard}>
          <MenuRow icon="star-outline" label="My Reviews" subtitle="All patient ratings and comments" onPress={showComingSoon} />
          <View style={styles.menuDivider} />
          <MenuRow icon="time-outline" label="Consultation History" onPress={showComingSoon} />
          <View style={styles.menuDivider} />
          <MenuRow icon="document-text-outline" label="My Documents" subtitle="View/update license and ID" onPress={showComingSoon} />
        </View>

        {/* ── Earnings Section ── */}
        <Text style={styles.sectionTitle}>Earnings</Text>
        <View style={styles.earningsCard}>
          <View style={styles.earningsRow}>
            <View style={styles.earningsItem}>
              <Text style={styles.earningsValue}>ETB 12,400</Text>
              <Text style={styles.earningsLabel}>Total Earned</Text>
            </View>
            <View style={styles.earningsDivider} />
            <View style={styles.earningsItem}>
              <Text style={styles.earningsValue}>ETB 1,800</Text>
              <Text style={styles.earningsLabel}>This Month</Text>
            </View>
          </View>
          <Pressable onPress={showComingSoon} style={styles.withdrawBtn}>
            <LinearGradient colors={gradients.interactive} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.withdrawGrad}>
              <Ionicons name="wallet-outline" size={18} color={colors.mistWhite} />
              <Text style={styles.withdrawText}>Withdraw Earnings</Text>
            </LinearGradient>
          </Pressable>
          <Pressable onPress={showComingSoon} style={styles.historyBtn}>
            <Text style={styles.historyText}>View Withdrawal History</Text>
          </Pressable>
        </View>

        {/* ── App Settings ── */}
        <Text style={styles.sectionTitle}>App Settings</Text>
        <View style={styles.menuCard}>
          <MenuRow icon="notifications-outline" label="Notifications" onPress={showComingSoon} />
          <View style={styles.menuDivider} />
          <MenuRow icon="language-outline" label="Language" onPress={showComingSoon} />
          <View style={styles.menuDivider} />
          <MenuRow icon="help-circle-outline" label="Help & Support" onPress={showComingSoon} />
          <View style={styles.menuDivider} />
          <MenuRow icon="shield-checkmark-outline" label="Privacy Policy" onPress={showComingSoon} />
          <View style={styles.menuDivider} />
          <MenuRow icon="information-circle-outline" label="About CareHub" onPress={showComingSoon} />
        </View>

        {/* ── Logout ── */}
        <Pressable onPress={handleLogout} style={styles.logoutBtn}>
          <Text style={styles.logoutText}>Logout</Text>
        </Pressable>

        <View style={{ height: 32 }} />
      </ScrollView>
    </SafeAreaView>
    </>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.cloudGrey },
  scroll: { paddingBottom: 24 },

  profileHeader: { alignItems: 'center', paddingTop: 24, paddingBottom: 24, paddingHorizontal: 24, gap: 6 },
  photoWrap: { position: 'relative', marginBottom: 8 },
  photo: { width: 88, height: 88, borderRadius: 44, borderWidth: 3, borderColor: 'rgba(255,255,255,0.4)' },
  photoFallback: { width: 88, height: 88, borderRadius: 44, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center', borderWidth: 3, borderColor: 'rgba(255,255,255,0.4)' },
  photoInitial: { fontFamily: fonts.bold, fontSize: 36, color: colors.mistWhite },
  editBadge: { position: 'absolute', bottom: 0, right: 0, width: 26, height: 26, borderRadius: 13, backgroundColor: colors.careBlue, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: colors.mistWhite },

  profileName: { fontFamily: fonts.bold, fontSize: 22, color: colors.mistWhite, textAlign: 'center' },
  profileSpecialty: { fontFamily: fonts.regular, fontSize: 14, color: 'rgba(255,255,255,0.8)', textAlign: 'center' },

  statsRow: { flexDirection: 'row', marginTop: 16, backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 16, paddingVertical: 12, paddingHorizontal: 20, gap: 0, width: '100%', justifyContent: 'space-around' },
  statItem: { alignItems: 'center', gap: 4 },
  statValue: { fontFamily: fonts.bold, fontSize: 15, color: colors.mistWhite },
  statLabel: { fontFamily: fonts.regular, fontSize: 11, color: 'rgba(255,255,255,0.7)' },
  statDivider: { width: 1, backgroundColor: 'rgba(255,255,255,0.25)' },
  onlineBadge: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  onlineDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.success },

  sectionTitle: { fontFamily: fonts.semiBold, fontSize: 15, color: '#6B7280', paddingHorizontal: 16, marginTop: 20, marginBottom: 8 },

  menuCard: { backgroundColor: colors.mistWhite, marginHorizontal: 16, borderRadius: 16, overflow: 'hidden', shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 4, elevation: 1 },
  menuRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, gap: 14 },
  menuIconWrap: { width: 36, height: 36, borderRadius: 10, backgroundColor: '#EFF6FF', alignItems: 'center', justifyContent: 'center' },
  menuIconWrapDanger: { backgroundColor: '#FFF5F5' },
  menuTextWrap: { flex: 1 },
  menuLabel: { fontFamily: fonts.medium, fontSize: 15, color: colors.inkBlack },
  menuLabelDanger: { color: colors.error },
  menuSubtitle: { fontFamily: fonts.regular, fontSize: 12, color: '#9CA3AF', marginTop: 1 },
  menuDivider: { height: 1, backgroundColor: colors.cloudGrey, marginLeft: 66 },

  earningsCard: { backgroundColor: colors.mistWhite, marginHorizontal: 16, borderRadius: 16, padding: 16, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 4, elevation: 1 },
  earningsRow: { flexDirection: 'row', marginBottom: 16 },
  earningsItem: { flex: 1, alignItems: 'center', gap: 4 },
  earningsDivider: { width: 1, backgroundColor: colors.cloudGrey },
  earningsValue: { fontFamily: fonts.bold, fontSize: 18, color: colors.inkBlack },
  earningsLabel: { fontFamily: fonts.regular, fontSize: 12, color: '#6B7280' },
  withdrawBtn: { borderRadius: 14, overflow: 'hidden', marginBottom: 10 },
  withdrawGrad: { height: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, borderRadius: 14 },
  withdrawText: { fontFamily: fonts.bold, fontSize: 15, color: colors.mistWhite },
  historyBtn: { alignItems: 'center', paddingVertical: 4 },
  historyText: { fontFamily: fonts.medium, fontSize: 13, color: colors.tealGreen },

  logoutBtn: { marginHorizontal: 16, marginTop: 20, paddingVertical: 16, alignItems: 'center' },
  logoutText: { fontFamily: fonts.semiBold, fontSize: 16, color: colors.error },
})

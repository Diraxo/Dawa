import { useAuth, useUser } from '@clerk/clerk-expo'
import { Ionicons } from '@expo/vector-icons'
import { LinearGradient } from 'expo-linear-gradient'
import { useFocusEffect, useRouter } from 'expo-router'
import { Image } from 'expo-image'
import { useCallback, useState } from 'react'
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useTranslation } from 'react-i18next'

import { CareHubAlert } from '@/components/ui/CareHubAlert'
import { VerifiedBadge } from '@/components/ui/VerifiedBadge'
import { colors } from '@/constants/colors'
import { fonts } from '@/constants/fonts'
import { gradients } from '@/constants/gradients'
import { useNavGuard } from '@/hooks/useNavGuard'
import { useOwnProfilePhoto } from '@/hooks/useOwnProfilePhoto'
import { clearPushTokens } from '@/lib/pushTokens'
import { shadow } from '@/lib/shadow'
import { getAuthClient, supabaseEmailAuth } from '@/lib/supabase'
import { getCachedJson, setCachedJson } from '@/lib/persistentCache'
import { useAuthStore } from '@/store/authStore'
import { useDoctorStore } from '@/store/doctorStore'

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
  // Guarded here once so every MenuRow call site (edit profile, my reviews,
  // documents, language, etc.) is protected against rapid repeat taps
  // stacking duplicate screens, without needing a guard at each call site.
  const guard = useNavGuard()
  return (
    <Pressable
      onPress={guard(onPress)}
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

interface ProfileData {
  rating: number
  consultations: number
  totalEarned: number
  monthEarned: number
  specialty: string
  hospital: string
  licenseNumber: string
  yearsExperience: number
  bio: string
  chatPrice: number
  phonePrice: number
  videoPrice: number
}

const DEFAULT_PROFILE: ProfileData = {
  rating: 0, consultations: 0, totalEarned: 0, monthEarned: 0,
  specialty: '', hospital: '', licenseNumber: '', yearsExperience: 0,
  bio: '', chatPrice: 0, phonePrice: 0, videoPrice: 0,
}

export default function DoctorProfileScreen() {
  const { user } = useUser()
  const { signOut, getToken, userId } = useAuth()
  const router = useRouter()
  const { t } = useTranslation()
  const { clearAuth, disconnectStream } = useAuthStore()
  const { doctorStatus } = useDoctorStore()
  const guardLogout = useNavGuard()

  const isPending = doctorStatus && doctorStatus !== 'approved'

  // Clerk populates user.fullName from firstName/lastName automatically, so
  // it's almost always present — the "Dr. " fallback below never used to
  // fire, leaving the doctor's own name on this screen without the prefix
  // every other doctor-facing screen shows. Strip any Dr. the doctor may
  // have typed into their name themselves first, so it's never doubled.
  const rawFullName = (user?.fullName ?? `${user?.firstName ?? ''} ${user?.lastName ?? ''}`.trim()).replace(/^Dr\.?\s*/i, '').trim()
  const fullName = rawFullName ? `Dr. ${rawFullName}` : 'Dr.'
  const initial = (user?.firstName?.[0] ?? rawFullName[0] ?? 'D').toUpperCase()

  const [profile, setProfile] = useState<ProfileData>(DEFAULT_PROFILE)
  const { photoUrl: profilePhotoUrl } = useOwnProfilePhoto()
  const [showLogoutAlert, setShowLogoutAlert] = useState(false)
  const [showComingSoonAlert, setShowComingSoonAlert] = useState(false)
  const [showDeleteAlert, setShowDeleteAlert] = useState(false)
  const [showDeleteConfirmAlert, setShowDeleteConfirmAlert] = useState(false)
  const [showDeleteErrorAlert, setShowDeleteErrorAlert] = useState(false)
  const profileCacheKey = userId ? `doctor-profile-data:${userId}` : null

  // Hydrate the last-known profile (rating/consultations/pricing/bio) from
  // disk immediately so returning to this tab shows real values instead of
  // DEFAULT_PROFILE's zeros/blanks while the focus-triggered fetch below is
  // still in flight — same cache-then-refresh pattern as useOwnProfilePhoto.
  useFocusEffect(
    useCallback(() => {
      if (!profileCacheKey) return
      let cancelled = false
      getCachedJson<ProfileData>(profileCacheKey).then((cached) => {
        if (cached && !cancelled) setProfile(cached)
      })
      return () => { cancelled = true }
    }, [profileCacheKey])
  )

  useFocusEffect(
    useCallback(() => {
      if (!userId) return
      getToken().then(async token => {
        if (!token) return
        const client = getAuthClient(token)

        const now = new Date()
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)

        // doctor_profiles SELECT RLS returns own row + every approved doctor's
        // row (for patient browsing), so this must be filtered to the caller's
        // own row or .single() throws once any other approved doctor exists.
        const { data: me } = await client.from('users').select('id').eq('clerk_id', userId).single()
        if (!me) return

        const [profileRes, totalRes, monthRes] = await Promise.all([
          client
            .from('doctor_profiles')
            .select(`
              rating_average, total_consultations, specialty, hospital_name,
              license_number, years_experience, bio,
              chat_price, phone_price, video_price
            `)
            .eq('user_id', (me as any).id)
            .single(),
          client.from('consultations').select('doctor_amount').eq('status', 'completed'),
          client.from('consultations').select('doctor_amount').eq('status', 'completed').gte('ended_at', monthStart.toISOString()),
        ])

        const totalEarned = (totalRes.data ?? []).reduce((s: number, r: any) => s + (Number(r.doctor_amount) || 0), 0)
        const monthEarned = (monthRes.data ?? []).reduce((s: number, r: any) => s + (Number(r.doctor_amount) || 0), 0)

        if (profileRes.data) {
          const p = profileRes.data as any
          const next: ProfileData = {
            rating: Number(p.rating_average ?? 0),
            consultations: p.total_consultations ?? 0,
            totalEarned,
            monthEarned,
            specialty: p.specialty ?? '',
            hospital: p.hospital_name ?? '',
            licenseNumber: p.license_number ?? '',
            yearsExperience: p.years_experience ?? 0,
            bio: p.bio ?? '',
            chatPrice: p.chat_price ?? 0,
            phonePrice: p.phone_price ?? 0,
            videoPrice: p.video_price ?? 0,
          }
          setProfile(next)
          if (profileCacheKey) setCachedJson(profileCacheKey, next)
        }
      })
    }, [userId, profileCacheKey])
  )

  const showComingSoon = () => setShowComingSoonAlert(true)

  const handleDeleteAccount = () => setShowDeleteAlert(true)

  const confirmDelete = () => {
    setShowDeleteAlert(false)
    setShowDeleteConfirmAlert(true)
  }

  const permanentlyDelete = async () => {
    setShowDeleteConfirmAlert(false)
    try {
      const token = await getToken().catch(() => null)
      if (token && user?.id) {
        const client = getAuthClient(token)

        // Best-effort document/photo cleanup — must never block account deletion.
        const [{ data: docs }, { data: photos }] = await Promise.all([
          client.storage.from('doctor-documents').list(user.id).catch(() => ({ data: null }) as never),
          client.storage.from('profile-photos').list(user.id).catch(() => ({ data: null }) as never),
        ])
        if (docs?.length) {
          await client.storage.from('doctor-documents').remove(docs.map((f) => `${user.id}/${f.name}`)).catch(() => {})
        }
        if (photos?.length) {
          await client.storage.from('profile-photos').remove(photos.map((f) => `${user.id}/${f.name}`)).catch(() => {})
        }

        // Anonymize rather than hard-delete the `users` row: doctor_profiles
        // cascades from users, and consultations cascade from
        // doctor_profiles — a hard delete here would silently wipe out
        // every consultation, summary, and record for every patient this
        // doctor ever saw, not just the doctor's own data. Scrubbing
        // personal/credential fields satisfies "delete my account" while
        // leaving patients' consultation history intact. `status`/
        // `availability` are left untouched (only an admin can change them,
        // enforced at the DB level); `is_online: false` alone is enough to
        // make the doctor unbookable going forward.
        const anonEmail = `deleted-${user.id}@dawa.invalid`
        await client.from('users').update({
          full_name: 'Deleted Doctor',
          email: anonEmail,
          phone: null,
          profile_photo_url: null,
          push_token: null,
          fcm_token: null,
          voip_token: null,
          address: null,
          is_suspended: true,
        })
        await client.from('doctor_profiles').update({
          bio: null,
          license_number: null,
          license_doc_url: null,
          id_doc_url: null,
          hospital_name: null,
          is_online: false,
        })
      }
      await supabaseEmailAuth.auth.signOut()
      await user?.delete()
      await disconnectStream()
      clearAuth()
      await signOut()
      router.replace('/(auth)/sign-in')
    } catch {
      setShowDeleteErrorAlert(true)
    }
  }

  const displayPhoto = profilePhotoUrl ?? user?.imageUrl ?? null
  const hasPricing = profile.chatPrice > 0 || profile.phonePrice > 0 || profile.videoPrice > 0

  return (
    <>
      <CareHubAlert
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
              try {
                const token = await getToken()
                if (token) {
                  await getAuthClient(token).from('doctor_profiles').update({ is_online: false })
                }
              } catch {
                // best-effort; the heartbeat TTL cleanup is the safety net
              }
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
      <CareHubAlert
        visible={showComingSoonAlert}
        variant="info"
        title="Account Pending"
        message="Withdrawals are available once your account is approved by our admin team."
        buttons={[
          { text: 'Got it', style: 'primary', onPress: () => setShowComingSoonAlert(false) },
        ]}
        onClose={() => setShowComingSoonAlert(false)}
      />
      <CareHubAlert
        visible={showDeleteAlert}
        variant="error"
        title="Delete Account"
        message="This will permanently remove your personal information and license/ID documents, and sign you out of Dawa. This cannot be undone."
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
        message="Your personal information and documents will be permanently removed and cannot be recovered. Your past consultation records are kept for your patients' medical record-keeping, as described in our Privacy Policy. Are you absolutely sure?"
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
        message="We couldn't delete your account. Please contact support at support@dawa.app"
        buttons={[
          { text: 'OK', style: 'primary', onPress: () => setShowDeleteErrorAlert(false) },
        ]}
        onClose={() => setShowDeleteErrorAlert(false)}
      />
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>

          {/* ── Profile Header ── */}
          <LinearGradient colors={gradients.hero} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.profileHeader}>
            <Pressable onPress={() => router.push('/(doctor)/edit-profile' as never)} style={styles.photoWrap}>
              {displayPhoto ? (
                <Image
                  source={{ uri: displayPhoto }}
                  style={styles.photo}
                  contentFit="cover"
                  cachePolicy="memory-disk"
                  transition={0}
                />
              ) : (
                <View style={styles.photoFallback}>
                  <Text style={styles.photoInitial}>{initial}</Text>
                </View>
              )}
              <View style={styles.editBadge}>
                <Ionicons name="camera" size={14} color={colors.mistWhite} />
              </View>
            </Pressable>
            <View style={styles.profileNameRow}>
              <Text style={styles.profileName}>{fullName}</Text>
              {doctorStatus === 'approved' && <VerifiedBadge size={18} />}
            </View>
            <Text style={styles.profileSpecialty}>
              {profile.specialty || 'General Practice'}{profile.hospital ? ` · ${profile.hospital}` : ''}
            </Text>

            {/* Stats row */}
            <View style={styles.statsRow}>
              <View style={styles.statItem}>
                {profile.rating > 0 ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                    <Ionicons name="star" size={13} color={colors.mistWhite} />
                    <Text style={styles.statValue}>{profile.rating.toFixed(1)}</Text>
                  </View>
                ) : (
                  <Text style={styles.statValue}>—</Text>
                )}
                <Text style={styles.statLabel}>{t('rating')}</Text>
              </View>
              <View style={styles.statDivider} />
              <View style={styles.statItem}>
                <Text style={styles.statValue}>{profile.consultations}</Text>
                <Text style={styles.statLabel}>{t('consultations')}</Text>
              </View>
              <View style={styles.statDivider} />
              <View style={styles.statItem}>
                <Text style={styles.statValue}>ETB {profile.totalEarned.toLocaleString()}</Text>
                <Text style={styles.statLabel}>{t('totalEarned')}</Text>
              </View>
            </View>
          </LinearGradient>

          {/* ── Approval Status Banner ── */}
          {isPending && (
            <View style={[styles.statusBanner, doctorStatus === 'rejected' && styles.statusBannerRejected]}>
              <Ionicons
                name={doctorStatus === 'rejected' ? 'close-circle-outline' : 'time-outline'}
                size={20}
                color={doctorStatus === 'rejected' ? colors.error : '#92400E'}
              />
              <Text style={[styles.statusBannerText, doctorStatus === 'rejected' && styles.statusBannerTextRejected]}>
                {doctorStatus === 'rejected'
                  ? 'Your application was not approved. Please contact support.'
                  : 'Your account is under review. You cannot accept consultations until the admin approves you.'}
              </Text>
            </View>
          )}

          {/* ── Professional Info Card ── */}
          {(profile.specialty || profile.licenseNumber || profile.yearsExperience > 0 || profile.bio) && (
            <>
              <Text style={styles.sectionTitle}>{t('professionalInfo')}</Text>
              <View style={styles.infoCard}>
                {!!profile.specialty && (
                  <View style={styles.infoRow}>
                    <View style={styles.infoIconWrap}>
                      <Ionicons name="medical-outline" size={18} color={colors.careBlue} />
                    </View>
                    <View style={styles.infoTextWrap}>
                      <Text style={styles.infoLabel}>{t('specialty')}</Text>
                      <Text style={styles.infoValue}>{profile.specialty}</Text>
                    </View>
                  </View>
                )}
                {profile.yearsExperience > 0 && (
                  <>
                    {!!profile.specialty && <View style={styles.infoDivider} />}
                    <View style={styles.infoRow}>
                      <View style={styles.infoIconWrap}>
                        <Ionicons name="time-outline" size={18} color={colors.careBlue} />
                      </View>
                      <View style={styles.infoTextWrap}>
                        <Text style={styles.infoLabel}>{t('experience')}</Text>
                        <Text style={styles.infoValue}>{profile.yearsExperience} {profile.yearsExperience === 1 ? 'year' : 'years'}</Text>
                      </View>
                    </View>
                  </>
                )}
                {!!profile.licenseNumber && (
                  <>
                    <View style={styles.infoDivider} />
                    <View style={styles.infoRow}>
                      <View style={styles.infoIconWrap}>
                        <Ionicons name="ribbon-outline" size={18} color={colors.careBlue} />
                      </View>
                      <View style={styles.infoTextWrap}>
                        <Text style={styles.infoLabel}>{t('licenseNumber')}</Text>
                        <Text style={styles.infoValue}>{profile.licenseNumber}</Text>
                      </View>
                    </View>
                  </>
                )}
                {!!profile.bio && (
                  <>
                    <View style={styles.infoDivider} />
                    <View style={styles.infoRow}>
                      <View style={styles.infoIconWrap}>
                        <Ionicons name="person-outline" size={18} color={colors.careBlue} />
                      </View>
                      <View style={styles.infoTextWrap}>
                        <Text style={styles.infoLabel}>{t('bio')}</Text>
                        <Text style={styles.infoValue} numberOfLines={3}>{profile.bio}</Text>
                      </View>
                    </View>
                  </>
                )}
              </View>
            </>
          )}

          {/* ── My Pricing Card ── */}
          <Text style={styles.sectionTitle}>{t('myPricing')}</Text>
          <View style={styles.pricingCard}>
            {[
              { icon: 'chatbubble-ellipses' as const, label: t('chat'), price: profile.chatPrice },
              { icon: 'call' as const, label: t('phoneCall'), price: profile.phonePrice },
              { icon: 'videocam' as const, label: t('videoCall'), price: profile.videoPrice },
            ].map(({ icon, label, price }, idx, arr) => (
              <View key={label}>
                <View style={styles.pricingRow}>
                  <Ionicons name={icon} size={18} color={colors.careBlue} style={styles.pricingIcon} />
                  <Text style={styles.pricingLabel}>{label}</Text>
                  <Text style={styles.pricingValue}>
                    {hasPricing ? `ETB ${price.toLocaleString()}` : '—'}
                  </Text>
                </View>
                {idx < arr.length - 1 && <View style={styles.pricingDivider} />}
              </View>
            ))}
            <Pressable
              onPress={() => router.push('/(doctor)/my-pricing' as never)}
              style={({ pressed }) => [styles.changePricesBtn, pressed && { opacity: 0.8 }]}
            >
              <LinearGradient colors={gradients.interactive} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.changePricesGrad}>
                <Ionicons name="pricetag-outline" size={16} color={colors.mistWhite} />
                <Text style={styles.changePricesText}>{t('changePrices')}</Text>
              </LinearGradient>
            </Pressable>
          </View>

          {/* ── Account Section ── */}
          <Text style={styles.sectionTitle}>{t('account')}</Text>
          <View style={styles.menuCard}>
            <MenuRow icon="person-outline" label={t('editProfile')} subtitle="Name, bio, photo, hospital" onPress={() => router.push('/(doctor)/edit-profile' as never)} />
            <View style={styles.menuDivider} />
            <MenuRow icon="medical-outline" label={t('mySpecialties')} subtitle="Specialty, experience, license" onPress={() => router.push('/(doctor)/my-specialties' as never)} />
            <View style={styles.menuDivider} />
            <MenuRow icon="trash-outline" label="Delete Account" subtitle="Permanently remove your account and data" onPress={handleDeleteAccount} danger />
          </View>

          {/* ── Work Section ── */}
          <Text style={styles.sectionTitle}>{t('work')}</Text>
          <View style={styles.menuCard}>
            <MenuRow icon="star-outline" label={t('myReviews')} subtitle="All patient ratings and comments" onPress={() => router.push('/(doctor)/my-reviews' as never)} />
            <View style={styles.menuDivider} />
            <MenuRow icon="time-outline" label={t('consultationHistory')} onPress={() => router.push('/(doctor)/consultation-history' as never)} />
            <View style={styles.menuDivider} />
            <MenuRow icon="document-text-outline" label={t('myDocuments')} subtitle="View license and ID" onPress={() => router.push('/(doctor)/my-documents' as never)} />
          </View>

          {/* ── Earnings Section ── */}
          <Text style={styles.sectionTitle}>{t('earnings')}</Text>
          <View style={styles.earningsCard}>
            <View style={styles.earningsRow}>
              <View style={styles.earningsItem}>
                <Text style={styles.earningsValue}>ETB {profile.totalEarned.toLocaleString()}</Text>
                <Text style={styles.earningsLabel}>{t('totalEarned')}</Text>
              </View>
              <View style={styles.earningsDivider} />
              <View style={styles.earningsItem}>
                <Text style={styles.earningsValue}>ETB {profile.monthEarned.toLocaleString()}</Text>
                <Text style={styles.earningsLabel}>{t('thisMonth')}</Text>
              </View>
            </View>
            <Pressable
              onPress={() => isPending ? showComingSoon() : router.push('/(doctor)/withdraw' as never)}
              style={styles.withdrawBtn}
            >
              <LinearGradient colors={gradients.interactive} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.withdrawGrad}>
                <Ionicons name="wallet-outline" size={18} color={colors.mistWhite} />
                <Text style={styles.withdrawText}>{t('withdrawEarnings')}</Text>
              </LinearGradient>
            </Pressable>
            <Pressable
              onPress={() => isPending ? showComingSoon() : router.push('/(doctor)/withdraw' as never)}
              style={styles.historyBtn}
            >
              <Text style={styles.historyText}>{t('viewWithdrawalHistory')}</Text>
            </Pressable>
          </View>

          {/* ── App Settings ── */}
          <Text style={styles.sectionTitle}>{t('appSettings')}</Text>
          <View style={styles.menuCard}>
            <MenuRow icon="time-outline" label={t('notificationHistory', { defaultValue: 'Notification History' })} onPress={() => router.push('/(doctor)/notifications' as never)} />
            <View style={styles.menuDivider} />
            <MenuRow icon="notifications-outline" label={t('notifications')} onPress={() => router.push('/(doctor)/notification-settings' as never)} />
            <View style={styles.menuDivider} />
            <MenuRow icon="language-outline" label={t('language')} onPress={() => router.push('/(doctor)/language-settings' as never)} />
            <View style={styles.menuDivider} />
            <MenuRow icon="help-circle-outline" label={t('helpSupport')} onPress={() => router.push('/(doctor)/help-support' as never)} />
            <View style={styles.menuDivider} />
            <MenuRow icon="shield-checkmark-outline" label={t('privacyPolicy')} onPress={() => router.push('/(doctor)/privacy-policy' as never)} />
            <View style={styles.menuDivider} />
            <MenuRow icon="information-circle-outline" label={t('aboutDawa')} onPress={() => router.push('/(doctor)/about-dawa' as never)} />
          </View>

          {/* ── Logout ── */}
          <Pressable onPress={() => setShowLogoutAlert(true)} style={styles.logoutBtn}>
            <Text style={styles.logoutText}>{t('logout')}</Text>
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

  profileNameRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  profileName: { fontFamily: fonts.bold, fontSize: 22, color: colors.mistWhite, textAlign: 'center' },
  profileSpecialty: { fontFamily: fonts.regular, fontSize: 14, color: 'rgba(255,255,255,0.8)', textAlign: 'center' },

  statsRow: { flexDirection: 'row', marginTop: 16, backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 16, paddingVertical: 12, paddingHorizontal: 12, width: '100%', justifyContent: 'space-around' },
  statItem: { alignItems: 'center', gap: 4, flex: 1 },
  statValue: { fontFamily: fonts.bold, fontSize: 13, color: colors.mistWhite, textAlign: 'center' },
  statLabel: { fontFamily: fonts.regular, fontSize: 11, color: 'rgba(255,255,255,0.7)' },
  statDivider: { width: 1, backgroundColor: 'rgba(255,255,255,0.25)' },

  sectionTitle: { fontFamily: fonts.semiBold, fontSize: 15, color: '#6B7280', paddingHorizontal: 16, marginTop: 20, marginBottom: 8 },

  // Professional Info card
  infoCard: { backgroundColor: colors.mistWhite, marginHorizontal: 16, borderRadius: 16, overflow: 'hidden', ...shadow('#000', 0, 1, 4, 0.05, 1) },
  infoRow: { flexDirection: 'row', alignItems: 'flex-start', paddingHorizontal: 16, paddingVertical: 14, gap: 14 },
  infoIconWrap: { width: 36, height: 36, borderRadius: 10, backgroundColor: '#EFF6FF', alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  infoTextWrap: { flex: 1 },
  infoLabel: { fontFamily: fonts.medium, fontSize: 12, color: '#9CA3AF', marginBottom: 2 },
  infoValue: { fontFamily: fonts.semiBold, fontSize: 14, color: colors.inkBlack, lineHeight: 20 },
  infoDivider: { height: 1, backgroundColor: colors.cloudGrey, marginLeft: 66 },

  // Pricing card
  pricingCard: { backgroundColor: colors.mistWhite, marginHorizontal: 16, borderRadius: 16, padding: 16, ...shadow('#000', 0, 1, 4, 0.05, 1) },
  pricingRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, gap: 12 },
  pricingIcon: { width: 28, textAlign: 'center' },
  pricingLabel: { fontFamily: fonts.medium, fontSize: 14, color: colors.inkBlack, flex: 1 },
  pricingValue: { fontFamily: fonts.bold, fontSize: 15, color: colors.careBlue },
  pricingDivider: { height: 1, backgroundColor: colors.cloudGrey, marginLeft: 40 },
  changePricesBtn: { borderRadius: 12, overflow: 'hidden', marginTop: 14 },
  changePricesGrad: { height: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  changePricesText: { fontFamily: fonts.bold, fontSize: 14, color: colors.mistWhite },

  menuCard: { backgroundColor: colors.mistWhite, marginHorizontal: 16, borderRadius: 16, overflow: 'hidden', ...shadow('#000', 0, 1, 4, 0.05, 1) },
  menuRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, gap: 14 },
  menuIconWrap: { width: 36, height: 36, borderRadius: 10, backgroundColor: '#EFF6FF', alignItems: 'center', justifyContent: 'center' },
  menuIconWrapDanger: { backgroundColor: '#FFF5F5' },
  menuTextWrap: { flex: 1 },
  menuLabel: { fontFamily: fonts.medium, fontSize: 15, color: colors.inkBlack },
  menuLabelDanger: { color: colors.error },
  menuSubtitle: { fontFamily: fonts.regular, fontSize: 12, color: '#9CA3AF', marginTop: 1 },
  menuDivider: { height: 1, backgroundColor: colors.cloudGrey, marginLeft: 66 },

  earningsCard: { backgroundColor: colors.mistWhite, marginHorizontal: 16, borderRadius: 16, padding: 16, ...shadow('#000', 0, 1, 4, 0.05, 1) },
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

  statusBanner: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    backgroundColor: '#FEF3C7', marginHorizontal: 16, marginTop: 14,
    borderRadius: 12, padding: 14, borderWidth: 1, borderColor: '#FDE68A',
  },
  statusBannerRejected: { backgroundColor: '#FEE2E2', borderColor: '#FECACA' },
  statusBannerText: { fontFamily: fonts.medium, fontSize: 13, color: '#92400E', flex: 1, lineHeight: 18 },
  statusBannerTextRejected: { color: colors.error },
})

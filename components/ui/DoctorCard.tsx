import { Ionicons } from '@expo/vector-icons'
import { LinearGradient } from 'expo-linear-gradient'
import { Image } from 'expo-image'
import { memo } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'

import { colors } from '@/constants/colors'
import { fonts } from '@/constants/fonts'
import { gradients } from '@/constants/gradients'
import { shadow } from '@/lib/shadow'
import { capitalizeLanguage } from '@/lib/languageFormat'
import { VerifiedBadge } from '@/components/ui/VerifiedBadge'
import { computeDoctorPresence, DoctorPresence } from '@/lib/doctorPresence'

export type Doctor = {
  id: string
  user_id?: string
  name: string
  subtitle?: string
  specialty: string
  rating_average: number
  review_count: number
  years_experience?: number
  bio?: string
  chat_price: number
  phone_price: number
  video_price: number
  is_online: boolean
  last_seen_at?: string | null
  last_seen_platform?: string | null
  profile_photo_url?: string | null
  availability?: Record<string, { enabled: boolean; startTime: string; endTime: string }> | null
  languages?: string[] | null
  // Every doctor a patient can see through this card is already admin-approved
  // (the lists that build these objects filter status='approved' server-side),
  // but the field stays explicit so the badge's gate is never implicit.
  status?: string | null
}

type Props = {
  doctor: Doctor
  onPress: (id: string) => void
  onBook?: (doctor: Doctor) => void
  mode?: 'grid' | 'list'
  // Grid mode only — lets a caller fit an exact number of cards in a fixed
  // viewport (e.g. Home's "show 2 full cards" carousels) instead of the
  // component's own fixed default width.
  cardWidth?: number
  // Recomputed by the caller on every render (including the 30s presence
  // tick from usePatientDoctors) and passed as a plain string so this memoed
  // component's shallow prop comparison actually picks up an Away timeout —
  // `doctor` itself doesn't change object identity when only time has
  // passed, so deriving presence from `doctor` inside this component would
  // never re-render on a stale-heartbeat transition. Falls back to a
  // point-in-time computation from `doctor` for callers that don't pass it.
  presence?: DoctorPresence
}

function DoctorCardImpl({ doctor, onPress, onBook, mode = 'grid', cardWidth, presence }: Props) {
  const resolvedPresence = presence ?? computeDoctorPresence(doctor)
  if (mode === 'list') {
    return (
      <View style={L.card}>
        {/* Top: photo + info */}
        <View style={L.topRow}>
          <View style={L.photoWrap}>
            {doctor.profile_photo_url ? (
              <Image
                source={{ uri: doctor.profile_photo_url }}
                style={L.photo}
                contentFit="cover"
                cachePolicy="memory-disk"
                transition={0}
                recyclingKey={doctor.id}
              />
            ) : (
              <View style={L.photoPlaceholder}>
                <Ionicons name="person" size={34} color={colors.steelGrey} />
              </View>
            )}
            {resolvedPresence !== 'offline' && (
              <View style={[L.onlineDot, resolvedPresence === 'away' && L.awayDot]} />
            )}
          </View>
          <View style={L.info}>
            <View style={L.nameRow}>
              <Text style={L.name} numberOfLines={1}>{doctor.name}</Text>
              {doctor.status === 'approved' && <VerifiedBadge size={15} />}
            </View>
            {resolvedPresence !== 'offline' && (
              <View style={[L.presencePill, resolvedPresence === 'away' && L.presencePillAway]}>
                <Text style={[L.presencePillText, resolvedPresence === 'away' && L.presencePillTextAway]}>
                  {resolvedPresence === 'available' ? 'Available Now' : 'Away'}
                </Text>
              </View>
            )}
            <Text style={L.specialty} numberOfLines={1}>{doctor.specialty}</Text>
            {doctor.subtitle ? (
              <Text style={L.hospital} numberOfLines={1}>{doctor.subtitle}</Text>
            ) : null}
            {doctor.languages && doctor.languages.length > 0 ? (
              <View style={L.languageRow}>
                <Ionicons name="language-outline" size={13} color={colors.tealGreen} />
                <Text style={L.languageText} numberOfLines={1}>{doctor.languages.map(capitalizeLanguage).join(', ')}</Text>
              </View>
            ) : null}
          </View>
        </View>

        {/* Divider */}
        <View style={L.divider} />

        {/* Action buttons */}
        <View style={L.btnRow}>
          <Pressable
            style={({ pressed }) => [L.viewBtn, pressed && { opacity: 0.75 }]}
            onPress={() => onPress(doctor.id)}
          >
            <Text style={L.viewBtnText}>View Profile</Text>
          </Pressable>
          <Pressable
            onPress={() => onBook?.(doctor)}
            style={({ pressed }) => [L.bookWrap, pressed && { opacity: 0.85 }]}
          >
            <LinearGradient
              colors={gradients.interactive}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={L.bookBtn}
            >
              <Text style={L.bookBtnText}>Book Consultation</Text>
            </LinearGradient>
          </Pressable>
        </View>
      </View>
    )
  }

  // Grid mode (used on Home screen)
  const lowestPrice = Math.min(doctor.chat_price, doctor.phone_price, doctor.video_price)
  return (
    <Pressable
      onPress={() => onPress(doctor.id)}
      style={({ pressed }) => [G.card, cardWidth ? { width: cardWidth } : null, pressed && G.pressed]}
    >
      <View style={G.photoWrap}>
        {doctor.profile_photo_url ? (
          <Image
            source={{ uri: doctor.profile_photo_url }}
            style={G.photo}
            contentFit="cover"
            cachePolicy="memory-disk"
            transition={0}
            recyclingKey={doctor.id}
          />
        ) : (
          <View style={G.photoPlaceholder}>
            <Ionicons name="person" size={30} color={colors.steelGrey} />
          </View>
        )}
        {resolvedPresence !== 'offline' && (
          <View style={[G.onlineDot, resolvedPresence === 'away' && G.awayDot]} />
        )}
      </View>
      <View style={G.nameRow}>
        <Text style={G.name} numberOfLines={1}>{doctor.name}</Text>
        {doctor.status === 'approved' && <VerifiedBadge size={12} />}
      </View>
      {doctor.subtitle ? (
        <Text style={G.subtitle} numberOfLines={1}>{doctor.subtitle}</Text>
      ) : null}
      <Text style={G.specialty} numberOfLines={1}>{doctor.specialty}</Text>
      <View style={G.metaRow}>
        <View style={G.ratingPill}>
          <Ionicons name="star" size={11} color={colors.warning} />
          <Text style={G.ratingText} numberOfLines={1}>
            {doctor.rating_average > 0 ? doctor.rating_average.toFixed(1) : '—'}
          </Text>
        </View>
        <Text style={G.priceText} numberOfLines={1}>ETB {lowestPrice}</Text>
      </View>
      {doctor.languages && doctor.languages.length > 0 ? (
        <View style={G.languageRow}>
          <Ionicons name="language-outline" size={11} color={colors.tealGreen} />
          <Text style={G.languageText} numberOfLines={1}>{doctor.languages.map(capitalizeLanguage).join(', ')}</Text>
        </View>
      ) : null}
      <Pressable
        onPress={() => (onBook ? onBook(doctor) : onPress(doctor.id))}
        style={({ pressed }) => [G.bookWrap, pressed && { opacity: 0.85 }]}
      >
        <LinearGradient
          colors={gradients.interactive}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={G.bookBtn}
        >
          <Text style={G.bookBtnText}>Book</Text>
        </LinearGradient>
      </Pressable>
    </Pressable>
  )
}

// Doctor list/home screens re-render this on every realtime tick (online
// status, price, rating ticks for OTHER doctors) — without memo every visible
// card (and its Image) remounts on each update even when its own doctor
// object is unchanged, discarding the in-flight fade/transition and forcing
// a redundant re-decode.
export const DoctorCard = memo(DoctorCardImpl)

// ─── List styles ──────────────────────────────────────────────────────────────
const L = StyleSheet.create({
  card: {
    backgroundColor: colors.mistWhite,
    borderRadius: 16,
    padding: 16,
    marginBottom: 14,
    ...shadow('#000', 0, 2, 8, 0.07, 2),
  },
  topRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 14 },
  photoWrap: { position: 'relative', flexShrink: 0 },
  photo: { width: 78, height: 78, borderRadius: 39 },
  photoPlaceholder: {
    width: 78, height: 78, borderRadius: 39,
    backgroundColor: colors.cloudGrey,
    alignItems: 'center', justifyContent: 'center',
  },
  onlineDot: {
    position: 'absolute', bottom: 2, right: 2,
    width: 16, height: 16, borderRadius: 8,
    backgroundColor: colors.success,
    borderWidth: 2.5, borderColor: colors.mistWhite,
  },
  awayDot: { backgroundColor: colors.warning },
  info: { flex: 1, paddingTop: 2 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 2 },
  name: { fontFamily: fonts.bold, fontSize: 16, color: colors.inkBlack, flexShrink: 1 },
  presencePill: {
    alignSelf: 'flex-start', paddingHorizontal: 7, paddingVertical: 2,
    borderRadius: 8, backgroundColor: `${colors.success}18`, marginBottom: 3,
  },
  presencePillAway: { backgroundColor: `${colors.warning}18` },
  presencePillText: { fontFamily: fonts.semiBold, fontSize: 10, color: colors.success },
  presencePillTextAway: { color: colors.warning },
  specialty: { fontFamily: fonts.medium, fontSize: 13, color: colors.tealGreen, marginBottom: 2 },
  hospital: { fontFamily: fonts.regular, fontSize: 12, color: '#6B7280', marginBottom: 4 },
  languageRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  languageText: { fontFamily: fonts.regular, fontSize: 12, color: '#6B7280', flexShrink: 1 },
  divider: { height: 1, backgroundColor: colors.cloudGrey, marginVertical: 12 },
  btnRow: { flexDirection: 'row', gap: 10, marginTop: 14 },
  viewBtn: {
    flex: 1, height: 44, borderRadius: 12,
    borderWidth: 1.5, borderColor: colors.steelGrey,
    alignItems: 'center', justifyContent: 'center',
  },
  viewBtnText: { fontFamily: fonts.semiBold, fontSize: 14, color: colors.inkBlack },
  bookWrap: { flex: 1, borderRadius: 12, overflow: 'hidden' },
  bookBtn: { height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 12 },
  bookBtnText: { fontFamily: fonts.bold, fontSize: 13, color: colors.mistWhite },
})

// ─── Grid styles (Home screen) ────────────────────────────────────────────────
const G = StyleSheet.create({
  card: {
    backgroundColor: colors.mistWhite,
    // Default (unconstrained) width — Home's carousels override this via the
    // `cardWidth` prop so exactly 2 cards fit the viewport; this fallback
    // only applies if a caller renders DoctorCard in grid mode without it.
    borderRadius: 16, padding: 12, width: 208, marginRight: 12,
    ...shadow('#000', 0, 2, 8, 0.07, 2),
  },
  pressed: { opacity: 0.85, transform: [{ scale: 0.98 }] },
  photoWrap: { alignSelf: 'center', marginBottom: 12, position: 'relative' },
  photo: { width: 72, height: 72, borderRadius: 36 },
  photoPlaceholder: {
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: colors.cloudGrey,
    alignItems: 'center', justifyContent: 'center',
  },
  onlineDot: {
    position: 'absolute', bottom: 3, right: 3,
    width: 12, height: 12, borderRadius: 6,
    backgroundColor: colors.success,
    borderWidth: 2, borderColor: colors.mistWhite,
  },
  awayDot: { backgroundColor: colors.warning },
  nameRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, marginBottom: 2 },
  name: { fontFamily: fonts.bold, fontSize: 13, color: colors.inkBlack, flexShrink: 1 },
  subtitle: { fontFamily: fonts.regular, fontSize: 11, color: '#6B7280', marginBottom: 2 },
  specialty: { fontFamily: fonts.regular, fontSize: 12, color: '#6B7280', marginBottom: 6 },
  metaRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  ratingPill: { flexDirection: 'row', alignItems: 'center', gap: 3, flexShrink: 1 },
  ratingText: { fontFamily: fonts.semiBold, fontSize: 13, color: colors.inkBlack },
  priceText: { fontFamily: fonts.bold, fontSize: 13, color: colors.tealGreen, flexShrink: 0 },
  languageRow: { flexDirection: 'row', alignItems: 'center', gap: 3, marginBottom: 8 },
  languageText: { fontFamily: fonts.regular, fontSize: 10, color: '#6B7280', flexShrink: 1 },
  bookWrap: { borderRadius: 10, overflow: 'hidden' },
  bookBtn: { height: 32, alignItems: 'center', justifyContent: 'center', borderRadius: 10 },
  bookBtnText: { fontFamily: fonts.bold, fontSize: 12, color: colors.mistWhite },
})

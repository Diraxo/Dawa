import { Ionicons } from '@expo/vector-icons'
import { LinearGradient } from 'expo-linear-gradient'
import { Image, Pressable, StyleSheet, Text, View } from 'react-native'

import { colors } from '@/constants/colors'
import { fonts } from '@/constants/fonts'
import { gradients } from '@/constants/gradients'
import { shadow } from '@/lib/shadow'

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
  profile_photo_url?: string | null
  availability?: Record<string, { enabled: boolean; startTime: string; endTime: string }> | null
  languages?: string[] | null
}

type Props = {
  doctor: Doctor
  onPress: (id: string) => void
  onBook?: (doctor: Doctor) => void
  mode?: 'grid' | 'list'
}

export function DoctorCard({ doctor, onPress, onBook, mode = 'grid' }: Props) {
  if (mode === 'list') {
    return (
      <View style={L.card}>
        {/* Top: photo + info */}
        <View style={L.topRow}>
          <View style={L.photoWrap}>
            {doctor.profile_photo_url ? (
              <Image source={{ uri: doctor.profile_photo_url }} style={L.photo} />
            ) : (
              <View style={L.photoPlaceholder}>
                <Ionicons name="person" size={34} color={colors.steelGrey} />
              </View>
            )}
            {doctor.is_online && <View style={L.onlineDot} />}
          </View>
          <View style={L.info}>
            <Text style={L.name} numberOfLines={1}>{doctor.name}</Text>
            <Text style={L.specialty} numberOfLines={1}>{doctor.specialty}</Text>
            {doctor.subtitle ? (
              <Text style={L.hospital} numberOfLines={1}>{doctor.subtitle}</Text>
            ) : null}
            {doctor.languages && doctor.languages.length > 0 ? (
              <View style={L.languageRow}>
                <Ionicons name="language-outline" size={13} color={colors.tealGreen} />
                <Text style={L.languageText} numberOfLines={1}>{doctor.languages.join(', ')}</Text>
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
  return (
    <Pressable
      onPress={() => onPress(doctor.id)}
      style={({ pressed }) => [G.card, pressed && G.pressed]}
    >
      <View style={G.photoWrap}>
        {doctor.profile_photo_url ? (
          <Image source={{ uri: doctor.profile_photo_url }} style={G.photo} />
        ) : (
          <View style={G.photoPlaceholder}>
            <Ionicons name="person" size={42} color={colors.steelGrey} />
          </View>
        )}
        {doctor.is_online && <View style={G.onlineDot} />}
      </View>
      <Text style={G.name} numberOfLines={1}>{doctor.name}</Text>
      {doctor.subtitle ? (
        <Text style={G.subtitle} numberOfLines={1}>{doctor.subtitle}</Text>
      ) : null}
      <Text style={G.specialty} numberOfLines={1}>{doctor.specialty}</Text>
      {doctor.languages && doctor.languages.length > 0 ? (
        <View style={G.languageRow}>
          <Ionicons name="language-outline" size={12} color={colors.tealGreen} />
          <Text style={G.languageText} numberOfLines={1}>{doctor.languages.join(', ')}</Text>
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
  info: { flex: 1, paddingTop: 2 },
  name: { fontFamily: fonts.bold, fontSize: 16, color: colors.inkBlack, marginBottom: 2 },
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
    // Widened from 172 — at that width a doctor's full name (e.g. "Dr.
    // Alexander Abrahamson") routinely wrapped to a second line even at
    // numberOfLines={1}'s minimum readable size. 208 comfortably fits a
    // typical two-part name at this font size without shrinking it.
    borderRadius: 16, padding: 14, width: 208, marginRight: 14,
    ...shadow('#000', 0, 2, 8, 0.07, 2),
  },
  pressed: { opacity: 0.85, transform: [{ scale: 0.98 }] },
  photoWrap: { alignSelf: 'center', marginBottom: 12, position: 'relative' },
  photo: { width: 90, height: 90, borderRadius: 45 },
  photoPlaceholder: {
    width: 90, height: 90, borderRadius: 45,
    backgroundColor: colors.cloudGrey,
    alignItems: 'center', justifyContent: 'center',
  },
  onlineDot: {
    position: 'absolute', bottom: 3, right: 3,
    width: 16, height: 16, borderRadius: 8,
    backgroundColor: colors.success,
    borderWidth: 2.5, borderColor: colors.mistWhite,
  },
  name: { fontFamily: fonts.semiBold, fontSize: 14, color: colors.inkBlack, marginBottom: 2 },
  subtitle: { fontFamily: fonts.regular, fontSize: 12, color: '#6B7280', marginBottom: 2 },
  specialty: { fontFamily: fonts.regular, fontSize: 12, color: '#6B7280', marginBottom: 4 },
  languageRow: { flexDirection: 'row', alignItems: 'center', gap: 3, marginBottom: 10 },
  languageText: { fontFamily: fonts.regular, fontSize: 11, color: '#6B7280', flexShrink: 1 },
  bookWrap: { borderRadius: 10, overflow: 'hidden' },
  bookBtn: { height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: 10 },
  bookBtnText: { fontFamily: fonts.bold, fontSize: 13, color: colors.mistWhite },
})

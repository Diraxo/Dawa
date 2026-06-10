import { Ionicons } from '@expo/vector-icons'
import { LinearGradient } from 'expo-linear-gradient'
import { Image, Pressable, StyleSheet, Text, View } from 'react-native'

import { colors } from '@/constants/colors'
import { fonts } from '@/constants/fonts'
import { gradients } from '@/constants/gradients'

export type Doctor = {
  id: string
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
            <View style={L.ratingRow}>
              <Ionicons name="star" size={13} color={colors.warning} />
              <Text style={L.ratingText}>{doctor.rating_average.toFixed(1)}</Text>
              <Text style={L.reviewText}>({doctor.review_count} reviews)</Text>
              {doctor.years_experience !== undefined ? (
                <Text style={L.expText}>· {doctor.years_experience} yrs exp</Text>
              ) : null}
            </View>
          </View>
        </View>

        {/* Divider */}
        <View style={L.divider} />

        {/* Consulting prices */}
        <Text style={L.consultLabel}>Consulting</Text>
        <View style={L.priceRow}>
          <View style={L.priceItem}>
            <View style={L.priceIconRow}>
              <Ionicons name="chatbubble-ellipses" size={13} color={colors.tealGreen} />
              <Text style={L.priceType}>Chat</Text>
            </View>
            <Text style={L.priceVal}>ETB {doctor.chat_price}</Text>
          </View>
          <View style={L.priceSep} />
          <View style={L.priceItem}>
            <View style={L.priceIconRow}>
              <Ionicons name="call" size={13} color={colors.careBlue} />
              <Text style={L.priceType}>Phone</Text>
            </View>
            <Text style={L.priceVal}>ETB {doctor.phone_price}</Text>
          </View>
          <View style={L.priceSep} />
          <View style={L.priceItem}>
            <View style={L.priceIconRow}>
              <Ionicons name="videocam" size={13} color="#7C3AED" />
              <Text style={L.priceType}>Video</Text>
            </View>
            <Text style={L.priceVal}>ETB {doctor.video_price}</Text>
          </View>
        </View>

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
      <Text style={G.name} numberOfLines={2}>{doctor.name}</Text>
      {doctor.subtitle ? (
        <Text style={G.subtitle} numberOfLines={1}>{doctor.subtitle}</Text>
      ) : null}
      <Text style={G.specialty} numberOfLines={1}>{doctor.specialty}</Text>
      <View style={G.ratingRow}>
        <Ionicons name="star" size={12} color={colors.warning} />
        <Text style={G.ratingText}>{doctor.rating_average.toFixed(1)}</Text>
        <Text style={G.reviewText}>{doctor.review_count} reviews</Text>
      </View>
      <View style={G.priceRow}>
        <View style={G.priceItem}>
          <Ionicons name="chatbubble-ellipses" size={10} color={colors.tealGreen} />
          <Text style={G.priceText}>{doctor.chat_price}</Text>
        </View>
        <View style={G.priceDivider} />
        <View style={G.priceItem}>
          <Ionicons name="call" size={10} color={colors.careBlue} />
          <Text style={G.priceText}>{doctor.phone_price}</Text>
        </View>
        <View style={G.priceDivider} />
        <View style={G.priceItem}>
          <Ionicons name="videocam" size={10} color="#7C3AED" />
          <Text style={G.priceText}>{doctor.video_price}</Text>
        </View>
        <Text style={G.priceCurrency}> ETB</Text>
      </View>
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
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.07,
    shadowRadius: 8,
    elevation: 2,
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
  ratingRow: { flexDirection: 'row', alignItems: 'center', gap: 4, flexWrap: 'wrap' },
  ratingText: { fontFamily: fonts.semiBold, fontSize: 13, color: colors.inkBlack },
  reviewText: { fontFamily: fonts.regular, fontSize: 12, color: '#9CA3AF' },
  expText: { fontFamily: fonts.regular, fontSize: 12, color: '#9CA3AF' },
  divider: { height: 1, backgroundColor: colors.cloudGrey, marginVertical: 12 },
  consultLabel: {
    fontFamily: fonts.semiBold, fontSize: 11, color: '#6B7280',
    textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10,
  },
  priceRow: { flexDirection: 'row', alignItems: 'center' },
  priceItem: { flex: 1, alignItems: 'center', gap: 4 },
  priceIconRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  priceType: { fontFamily: fonts.regular, fontSize: 12, color: '#6B7280' },
  priceVal: { fontFamily: fonts.semiBold, fontSize: 12, color: colors.inkBlack },
  priceSep: { width: 1, height: 36, backgroundColor: colors.steelGrey },
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
    borderRadius: 16, padding: 14, width: 172, marginRight: 14,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.07, shadowRadius: 8, elevation: 2,
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
  specialty: { fontFamily: fonts.regular, fontSize: 12, color: '#6B7280', marginBottom: 8 },
  ratingRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 6 },
  ratingText: { fontFamily: fonts.semiBold, fontSize: 12, color: colors.inkBlack },
  reviewText: { fontFamily: fonts.regular, fontSize: 11, color: '#9CA3AF' },
  priceRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 4, marginTop: 2 },
  priceItem: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  priceText: { fontFamily: fonts.semiBold, fontSize: 11, color: colors.inkBlack },
  priceDivider: { width: 1, height: 10, backgroundColor: colors.steelGrey },
  priceCurrency: { fontFamily: fonts.medium, fontSize: 10, color: '#9CA3AF' },
})

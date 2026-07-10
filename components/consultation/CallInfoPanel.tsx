import { Ionicons } from '@expo/vector-icons'
import { Image, Pressable, StyleSheet, Text, View } from 'react-native'

import { colors } from '@/constants/colors'
import { fonts } from '@/constants/fonts'

interface CallInfoPanelProps {
  visible: boolean
  onClose: () => void
  consultationId: string | undefined
  consultationType: 'phone' | 'video'
  counterpartLabel: string // "Doctor" | "Patient"
  counterpartName: string
  counterpartPhotoUrl?: string | null
  startedAtIso: string | null
  elapsedSeconds: number
  networkQuality: number // Agora 0-6 scale — 0 unknown, 1-2 excellent, 3-4 fair, 5-6 poor
}

function formatElapsed(seconds: number) {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function formatStartedAt(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

function qualityMeta(quality: number) {
  if (quality === 0) return { label: 'Measuring…', bars: 3, color: 'rgba(255,255,255,0.4)' }
  if (quality <= 2) return { label: 'Excellent', bars: 3, color: colors.success }
  if (quality <= 4) return { label: 'Fair', bars: 2, color: colors.warning }
  return { label: 'Poor', bars: 1, color: colors.error }
}

// Shared native call-info sheet — one implementation for all 4 doctor/patient
// phone/video screens, so the field set (and Consultation ID formatting)
// can never drift between them again. Mirrors the fields shown by the web
// reference (carehub-web/components/consultation/ConsultationInfoPanel.tsx):
// counterpart identity, Consultation ID, Type, Started, Duration, Connection
// quality, and a generic "End-to-end encrypted" pill — no vendor/diagnostic
// details (no "Agora", no crypto-algorithm names).
export function CallInfoPanel({
  visible, onClose, consultationId, consultationType, counterpartLabel,
  counterpartName, counterpartPhotoUrl, startedAtIso, elapsedSeconds, networkQuality,
}: CallInfoPanelProps) {
  if (!visible) return null

  const q = qualityMeta(networkQuality)

  return (
    <>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={styles.sheet}>
        <View style={styles.handle} />
        <View style={styles.header}>
          <Text style={styles.title}>Consultation Info</Text>
          <Pressable onPress={onClose} hitSlop={12}>
            <Ionicons name="close" size={22} color="rgba(255,255,255,0.7)" />
          </Pressable>
        </View>

        <View style={styles.identity}>
          <View style={styles.avatarCircle}>
            {counterpartPhotoUrl ? (
              <Image source={{ uri: counterpartPhotoUrl }} style={styles.avatarImage} />
            ) : (
              <Ionicons name="person" size={30} color="rgba(255,255,255,0.5)" />
            )}
          </View>
          <Text style={styles.identityName}>{counterpartName}</Text>
          <Text style={styles.identityLabel}>{counterpartLabel}</Text>
        </View>

        <View style={styles.body}>
          {!!consultationId && (
            <View style={styles.row}>
              <Text style={styles.label}>Consultation ID</Text>
              <Text style={[styles.value, styles.mono]}>{consultationId.slice(0, 8).toUpperCase()}</Text>
            </View>
          )}
          <View style={styles.row}>
            <Text style={styles.label}>Type</Text>
            <View style={styles.typeValue}>
              <Ionicons name={consultationType === 'phone' ? 'call' : 'videocam'} size={13} color={colors.mistWhite} />
              <Text style={styles.value}>{consultationType === 'phone' ? 'Phone' : 'Video'}</Text>
            </View>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Started</Text>
            <Text style={styles.value}>{formatStartedAt(startedAtIso)}</Text>
          </View>
          <View style={[styles.row, { borderBottomWidth: 0 }]}>
            <Text style={styles.label}>Duration</Text>
            <Text style={[styles.value, styles.mono]}>{formatElapsed(elapsedSeconds)}</Text>
          </View>
          <View style={styles.connectionRow}>
            <Text style={styles.label}>Connection</Text>
            <View style={styles.connectionValue}>
              <View style={styles.bars}>
                {[1, 2, 3].map(b => (
                  <View
                    key={b}
                    style={[
                      styles.bar,
                      { height: 4 + b * 3, backgroundColor: b <= q.bars ? q.color : 'rgba(255,255,255,0.15)' },
                    ]}
                  />
                ))}
              </View>
              <Text style={[styles.value, { color: q.color }]}>{q.label}</Text>
            </View>
          </View>
        </View>

        <View style={styles.securePill}>
          <Ionicons name="lock-closed" size={12} color={colors.tealGreen} />
          <Text style={styles.securePillText}>End-to-end encrypted</Text>
        </View>
      </View>
    </>
  )
}

const styles = StyleSheet.create({
  backdrop: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  sheet: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: '#10172B',
    borderTopLeftRadius: 22, borderTopRightRadius: 22,
    paddingTop: 8, paddingBottom: 28,
    elevation: 24,
    shadowColor: '#000', shadowOffset: { width: 0, height: -6 },
    shadowOpacity: 0.5, shadowRadius: 16,
  },
  handle: {
    alignSelf: 'center', width: 36, height: 4, borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.2)', marginBottom: 8,
  },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingBottom: 12,
  },
  title: { fontFamily: fonts.bold, fontSize: 15, color: colors.mistWhite },
  identity: { alignItems: 'center', gap: 6, paddingBottom: 18 },
  avatarCircle: {
    width: 68, height: 68, borderRadius: 34,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
  },
  avatarImage: { width: '100%', height: '100%' },
  identityName: { fontFamily: fonts.bold, fontSize: 16, color: colors.mistWhite, marginTop: 4 },
  identityLabel: { fontFamily: fonts.regular, fontSize: 12, color: 'rgba(255,255,255,0.5)' },
  body: {
    marginHorizontal: 20, borderRadius: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  row: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.08)',
  },
  connectionRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12,
  },
  label: { fontFamily: fonts.regular, fontSize: 12, color: 'rgba(255,255,255,0.5)' },
  value: { fontFamily: fonts.semiBold, fontSize: 12, color: colors.mistWhite },
  mono: { fontFamily: fonts.medium },
  typeValue: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  connectionValue: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  bars: { flexDirection: 'row', alignItems: 'flex-end', gap: 2, height: 14 },
  bar: { width: 3, borderRadius: 1.5 },
  securePill: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    alignSelf: 'flex-start', marginLeft: 20, marginTop: 16,
    backgroundColor: 'rgba(0,191,165,0.1)', borderWidth: 1, borderColor: 'rgba(0,191,165,0.25)',
    borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7,
  },
  securePillText: { fontFamily: fonts.semiBold, fontSize: 11, color: colors.tealGreen },
})

import { Ionicons } from '@expo/vector-icons'
import { Image } from 'expo-image'
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native'

import { GradientButton } from '@/components/ui/GradientButton'
import { colors } from '@/constants/colors'
import { fonts } from '@/constants/fonts'

export interface AppointmentDetails {
  id: string
  type: 'chat' | 'phone' | 'video'
  status: string
  patientName: string
  patientPhotoUrl: string | null
  whenLabel: string
  /** Actual elapsed minutes for a completed call; falls back to the standard slot length. */
  durationMinutes?: number
}

const TYPE_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  chat: 'chatbubble-outline',
  phone: 'call-outline',
  video: 'videocam-outline',
}

const JOINABLE_STATUSES = new Set(['active', 'accepted', 'in_progress'])
const DEFAULT_DURATION_MINS = 20

interface Props {
  appt: AppointmentDetails | null
  onClose: () => void
  onJoin: (appt: AppointmentDetails) => void
  onViewSummary: (appt: AppointmentDetails) => void
}

// Mobile counterpart to carehub-web/components/doctor/AppointmentDetailsModal.tsx —
// tapping a Today's Schedule / Upcoming Appointments card opens this instead
// of a bare Alert.alert, matching web's tap-to-view-details behavior.
export function AppointmentDetailsSheet({ appt, onClose, onJoin, onViewSummary }: Props) {
  if (!appt) return null
  const icon = TYPE_ICONS[appt.type] ?? 'medical-outline'

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.card} onPress={(e) => e.stopPropagation()}>
          <View style={styles.header}>
            <View style={styles.avatarWrap}>
              {appt.patientPhotoUrl ? (
                <Image
                  source={{ uri: appt.patientPhotoUrl }}
                  style={styles.avatar}
                  contentFit="cover"
                  cachePolicy="memory-disk"
                  transition={0}
                />
              ) : (
                <View style={styles.avatarFallback}>
                  <Text style={styles.avatarFallbackText}>{appt.patientName.charAt(0) || '?'}</Text>
                </View>
              )}
            </View>
            <View style={styles.headerText}>
              <Text style={styles.patientName}>{appt.patientName}</Text>
              <Text style={styles.status}>{appt.status.replace(/_/g, ' ')}</Text>
            </View>
            <Pressable onPress={onClose} hitSlop={12}>
              <Ionicons name="close" size={22} color={colors.inkBlack} style={{ opacity: 0.4 }} />
            </Pressable>
          </View>

          <View style={styles.infoList}>
            <View style={styles.infoRow}>
              <Ionicons name={icon} size={16} color={colors.careBlue} />
              <Text style={styles.infoText}>{appt.type.charAt(0).toUpperCase() + appt.type.slice(1)} consultation</Text>
            </View>
            <View style={styles.infoRow}>
              <Ionicons name="time-outline" size={16} color={colors.careBlue} />
              <Text style={styles.infoText}>{appt.whenLabel}</Text>
            </View>
            <View style={styles.infoRow}>
              <Ionicons name="hourglass-outline" size={16} color={colors.careBlue} />
              <Text style={styles.infoText}>{appt.durationMinutes ?? DEFAULT_DURATION_MINS} min</Text>
            </View>
          </View>

          {JOINABLE_STATUSES.has(appt.status) && (
            <GradientButton label="Join Call" onPress={() => onJoin(appt)} />
          )}
          {appt.status === 'completed' && (
            <Pressable style={styles.outlineBtn} onPress={() => onViewSummary(appt)}>
              <Text style={styles.outlineBtnText}>View Summary</Text>
            </Pressable>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center', padding: 20 },
  card: { width: '100%', maxWidth: 380, backgroundColor: colors.mistWhite, borderRadius: 24, padding: 20 },
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  avatarWrap: { marginRight: 12 },
  avatar: { width: 52, height: 52, borderRadius: 16 },
  avatarFallback: {
    width: 52, height: 52, borderRadius: 16, backgroundColor: colors.careBlue,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarFallbackText: { fontFamily: fonts.bold, fontSize: 20, color: '#FFFFFF' },
  headerText: { flex: 1 },
  patientName: { fontFamily: fonts.bold, fontSize: 16, color: colors.inkBlack },
  status: { fontFamily: fonts.regular, fontSize: 12, color: '#6B7280', textTransform: 'capitalize', marginTop: 2 },
  infoList: { gap: 10, marginBottom: 20 },
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  infoText: { fontFamily: fonts.regular, fontSize: 14, color: colors.inkBlack, opacity: 0.75 },
  outlineBtn: {
    height: 52, borderRadius: 16, borderWidth: 1.5, borderColor: colors.steelGrey,
    alignItems: 'center', justifyContent: 'center',
  },
  outlineBtnText: { fontFamily: fonts.bold, fontSize: 16, color: colors.inkBlack },
})

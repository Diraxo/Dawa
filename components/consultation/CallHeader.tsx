import { Ionicons } from '@expo/vector-icons'
import { Image, Pressable, StyleSheet, Text, View } from 'react-native'

import { colors } from '@/constants/colors'
import { fonts } from '@/constants/fonts'
import { formatCallDuration } from '@/lib/callDuration'

export type ConnectionStatus = 'connecting' | 'connected' | 'reconnecting' | 'disconnected'

const STATUS_LABEL: Record<ConnectionStatus, string> = {
  connecting: 'Connecting',
  connected: 'Connected',
  reconnecting: 'Reconnecting',
  disconnected: 'Disconnected',
}
const STATUS_COLOR: Record<ConnectionStatus, string> = {
  connecting: colors.information,
  connected: colors.success,
  reconnecting: colors.warning,
  disconnected: colors.error,
}

interface CallHeaderProps {
  elapsedSeconds: number
  connectionStatus: ConnectionStatus
  counterpartName: string
  counterpartPhotoUrl?: string | null
  onChatPress: () => void
  chatActive?: boolean
  unreadCount?: number
  onSwitchCamera: () => void
  onInfoPress: () => void
  disabled?: boolean
}

// Shared header for all 4 doctor/patient video call screens — one
// implementation so the doctor and patient layouts can never drift apart
// again. Only `counterpartName`/`counterpartPhotoUrl` (and the "Dr." prefix,
// applied by the caller) differ between the two roles.
//
// Layout is two flex rows rather than absolute-positioned overlays so the
// three zones (timer/buttons, participant chip, status/info) can never
// overlap each other regardless of name length or screen size:
//   Row 1: [ timer badge ] [ participant chip ] [ connection status ]
//   Row 2: [ chat + switch-camera ]         [ info ]
export function CallHeader({
  elapsedSeconds,
  connectionStatus,
  counterpartName,
  counterpartPhotoUrl,
  onChatPress,
  chatActive = false,
  unreadCount = 0,
  onSwitchCamera,
  onInfoPress,
  disabled = false,
}: CallHeaderProps) {
  const timerText = connectionStatus === 'connected'
    ? formatCallDuration(elapsedSeconds)
    : `${STATUS_LABEL[connectionStatus]}…`

  return (
    <View style={styles.header} pointerEvents="box-none">
      <View style={styles.row}>
        <View style={[styles.timerBadge, { borderColor: `${STATUS_COLOR[connectionStatus]}66` }]}>
          <View style={[styles.dot, { backgroundColor: STATUS_COLOR[connectionStatus] }]} />
          <Text style={styles.timerText} numberOfLines={1}>{timerText}</Text>
        </View>

        <View style={styles.centerChip} pointerEvents="none">
          {counterpartPhotoUrl ? (
            <Image source={{ uri: counterpartPhotoUrl }} style={styles.centerPhoto} />
          ) : (
            <View style={styles.centerPhotoFallback}>
              <Ionicons name="person" size={13} color="rgba(255,255,255,0.5)" />
            </View>
          )}
          <Text style={styles.centerName} numberOfLines={1}>{counterpartName}</Text>
        </View>

        <View style={[styles.statusChip, { borderColor: `${STATUS_COLOR[connectionStatus]}66` }]}>
          <Text style={[styles.statusText, { color: STATUS_COLOR[connectionStatus] }]} numberOfLines={1}>
            {STATUS_LABEL[connectionStatus]}
          </Text>
        </View>
      </View>

      <View style={styles.row}>
        <View style={styles.leftButtons}>
          <HeaderIconBtn icon="chatbubble-ellipses" active={chatActive} disabled={disabled} onPress={onChatPress} accessibilityLabel="Chat" />
          {unreadCount > 0 && !chatActive && (
            <View style={styles.unreadBadge}>
              <Text style={styles.unreadBadgeText}>{unreadCount > 99 ? '99+' : unreadCount}</Text>
            </View>
          )}
          <HeaderIconBtn icon="camera-reverse" disabled={disabled} onPress={onSwitchCamera} accessibilityLabel="Switch camera" />
        </View>

        <View style={styles.rightButtons}>
          <HeaderIconBtn icon="information-circle-outline" disabled={disabled} onPress={onInfoPress} accessibilityLabel="Call info" />
        </View>
      </View>
    </View>
  )
}

function HeaderIconBtn({ icon, active = false, disabled = false, onPress, accessibilityLabel }: {
  icon: string; active?: boolean; disabled?: boolean; onPress: () => void; accessibilityLabel: string
}) {
  return (
    <Pressable
      style={({ pressed }) => [
        styles.iconBtn,
        active && styles.iconBtnActive,
        disabled && styles.iconBtnDisabled,
        pressed && !disabled && { opacity: 0.75 },
      ]}
      disabled={disabled}
      onPress={onPress}
      accessibilityLabel={accessibilityLabel}
      hitSlop={8}
    >
      <Ionicons name={icon as any} size={17} color={disabled ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.9)'} />
    </Pressable>
  )
}

const styles = StyleSheet.create({
  header: { position: 'absolute', top: 12, left: 12, right: 12, gap: 8 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },

  timerBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 16, borderWidth: 1,
    paddingHorizontal: 10, paddingVertical: 6, maxWidth: 110,
  },
  dot: { width: 7, height: 7, borderRadius: 3.5 },
  timerText: { fontFamily: fonts.semiBold, fontSize: 12, color: colors.mistWhite },

  centerChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1,
    backgroundColor: 'rgba(0,0,0,0.45)', borderRadius: 16,
    paddingHorizontal: 8, paddingVertical: 5,
  },
  centerPhoto: { width: 20, height: 20, borderRadius: 10 },
  centerPhotoFallback: {
    width: 20, height: 20, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center', justifyContent: 'center',
  },
  centerName: { fontFamily: fonts.semiBold, fontSize: 12, color: colors.mistWhite, flexShrink: 1 },

  statusChip: {
    backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 16, borderWidth: 1,
    paddingHorizontal: 10, paddingVertical: 6, maxWidth: 100,
  },
  statusText: { fontFamily: fonts.semiBold, fontSize: 11 },

  leftButtons: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rightButtons: { flexDirection: 'row', alignItems: 'center', gap: 8 },

  iconBtn: {
    width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  iconBtnActive: { backgroundColor: colors.careBlue },
  iconBtnDisabled: { backgroundColor: 'rgba(0,0,0,0.2)' },

  unreadBadge: {
    position: 'absolute', top: -4, left: 24,
    minWidth: 16, height: 16, borderRadius: 8,
    backgroundColor: colors.error, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 3, borderWidth: 1.5, borderColor: '#070E27', zIndex: 1,
  },
  unreadBadgeText: { fontFamily: fonts.bold, fontSize: 9, color: '#fff' },
})

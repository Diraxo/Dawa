import { Ionicons } from '@expo/vector-icons'
import {
  Alert,
  Image,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TouchableWithoutFeedback,
  View,
} from 'react-native'

import { colors } from '@/constants/colors'
import { shadow } from '@/lib/shadow'
import { fonts } from '@/constants/fonts'

// ─── Types ────────────────────────────────────────────────────────────────────

export type Conversation = {
  id: string
  doctorId: string
  doctorName: string
  doctorSubtitle: string
  doctorPhotoUrl: string | null
  lastMessage: string
  lastMessageTime: string
  unreadCount: number
  isOnline: boolean
  isPinned: boolean
  consultationStatus: 'active' | 'completed'
  menuVisible?: boolean
}

type Props = {
  item: Conversation
  menuVisible: boolean
  onPress: (id: string) => void
  onLongPress: (id: string) => void
  onMenuClose: () => void
  onDelete: (id: string) => void
  onPin: (id: string) => void
  onArchive: (id: string) => void
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getDoctorInitial(name: string): string {
  const parts = name.split(' ')
  const first = parts.find(p => p !== 'Dr.' && p !== 'Dr' && p.length > 0)
  return first?.charAt(0).toUpperCase() ?? 'D'
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ConversationItem({
  item,
  menuVisible,
  onPress,
  onLongPress,
  onMenuClose,
  onDelete,
  onPin,
  onArchive,
}: Props) {
  return (
    <>
      <Pressable
        onPress={() => onPress(item.id)}
        onLongPress={() => onLongPress(item.id)}
        delayLongPress={400}
        style={({ pressed }) => [styles.container, pressed && styles.pressed]}
      >
        {/* ── Avatar ── */}
        <View style={styles.avatarWrap}>
          {item.doctorPhotoUrl ? (
            <Image source={{ uri: item.doctorPhotoUrl }} style={styles.avatar} />
          ) : (
            <View style={styles.avatarFallback}>
              <Text style={styles.avatarInitial}>{getDoctorInitial(item.doctorName)}</Text>
            </View>
          )}
          <View
            style={[
              styles.statusDot,
              { backgroundColor: item.isOnline ? colors.success : '#9CA3AF' },
            ]}
          />
        </View>

        {/* ── Text content ── */}
        <View style={styles.content}>
          {/* Row 1: name + time */}
          <View style={styles.topRow}>
            <View style={styles.nameRow}>
              {item.isPinned && (
                <Ionicons name="pin" size={11} color={colors.tealGreen} style={styles.pinIcon} />
              )}
              <Text style={styles.doctorName} numberOfLines={1}>
                {item.doctorName}
              </Text>
            </View>
            <Text style={styles.time}>{item.lastMessageTime}</Text>
          </View>

          {/* Row 2: subtitle */}
          <Text style={styles.subtitle} numberOfLines={1}>
            {item.doctorSubtitle}
          </Text>

          {/* Row 3: last message + badge */}
          <View style={styles.bottomRow}>
            <Text
              style={[
                styles.lastMessage,
                item.unreadCount > 0 && styles.lastMessageBold,
              ]}
              numberOfLines={2}
            >
              {item.lastMessage}
            </Text>
            {item.unreadCount > 0 ? (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>
                  {item.unreadCount > 9 ? '9+' : item.unreadCount}
                </Text>
              </View>
            ) : null}
          </View>
        </View>
      </Pressable>

      {/* ── Long-press context menu ── */}
      <Modal
        visible={menuVisible}
        transparent
        animationType="fade"
        onRequestClose={onMenuClose}
        statusBarTranslucent
      >
        <TouchableWithoutFeedback onPress={onMenuClose}>
          <View style={styles.overlay}>
            <TouchableWithoutFeedback>
              <View style={styles.menu}>
                {/* Doctor name header */}
                <Text style={styles.menuHeader} numberOfLines={1}>
                  {item.doctorName}
                </Text>
                <View style={styles.divider} />

                {/* Pin */}
                <Pressable
                  style={({ pressed }) => [styles.menuItem, pressed && styles.menuItemPressed]}
                  onPress={() => {
                    onMenuClose()
                    onPin(item.id)
                  }}
                >
                  <Ionicons
                    name={item.isPinned ? 'pin-outline' : 'pin'}
                    size={18}
                    color={colors.inkBlack}
                  />
                  <Text style={styles.menuItemText}>
                    {item.isPinned ? 'Unpin Chat' : 'Pin Chat'}
                  </Text>
                </Pressable>

                {/* Archive */}
                <Pressable
                  style={({ pressed }) => [styles.menuItem, pressed && styles.menuItemPressed]}
                  onPress={() => {
                    onMenuClose()
                    onArchive(item.id)
                  }}
                >
                  <Ionicons name="archive-outline" size={18} color={colors.inkBlack} />
                  <Text style={styles.menuItemText}>Archive Chat</Text>
                </Pressable>

                <View style={styles.divider} />

                {/* Delete */}
                <Pressable
                  style={({ pressed }) => [styles.menuItem, pressed && styles.menuItemPressed]}
                  onPress={() => {
                    onMenuClose()
                    Alert.alert(
                      'Delete Chat',
                      `Delete your conversation with ${item.doctorName}? This cannot be undone.`,
                      [
                        { text: 'Cancel', style: 'cancel' },
                        {
                          text: 'Delete',
                          style: 'destructive',
                          onPress: () => onDelete(item.id),
                        },
                      ]
                    )
                  }}
                >
                  <Ionicons name="trash-outline" size={18} color={colors.error} />
                  <Text style={[styles.menuItemText, styles.menuItemDanger]}>Delete Chat</Text>
                </Pressable>
              </View>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>
    </>
  )
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.mistWhite,
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 12,
  },
  pressed: {
    backgroundColor: '#F9FAFB',
  },

  // Avatar
  avatarWrap: {
    position: 'relative',
    width: 52,
    height: 52,
    flexShrink: 0,
  },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
  },
  avatarFallback: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#E0E7FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: {
    fontFamily: fonts.bold,
    fontSize: 20,
    color: colors.careBlue,
  },
  statusDot: {
    position: 'absolute',
    bottom: 2,
    right: 2,
    width: 13,
    height: 13,
    borderRadius: 7,
    borderWidth: 2,
    borderColor: colors.mistWhite,
  },

  // Content
  content: {
    flex: 1,
    gap: 2,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    flex: 1,
  },
  pinIcon: {
    marginTop: 1,
  },
  doctorName: {
    fontFamily: fonts.bold,
    fontSize: 15,
    color: colors.inkBlack,
    flex: 1,
  },
  time: {
    fontFamily: fonts.regular,
    fontSize: 12,
    color: '#9CA3AF',
    flexShrink: 0,
  },
  subtitle: {
    fontFamily: fonts.regular,
    fontSize: 12,
    color: '#9CA3AF',
    marginTop: 1,
  },
  bottomRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: 8,
    marginTop: 3,
  },
  lastMessage: {
    fontFamily: fonts.regular,
    fontSize: 13,
    color: '#6B7280',
    flex: 1,
    lineHeight: 18,
  },
  lastMessageBold: {
    fontFamily: fonts.medium,
    color: colors.inkBlack,
  },
  badge: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.tealGreen,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
    flexShrink: 0,
  },
  badgeText: {
    fontFamily: fonts.bold,
    fontSize: 11,
    color: colors.mistWhite,
  },

  // Context menu overlay
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  menu: {
    backgroundColor: colors.mistWhite,
    borderRadius: 20,
    paddingVertical: 8,
    width: '100%',
    ...shadow('#000', 0, 8, 20, 0.15, 10),
  },
  menuHeader: {
    fontFamily: fonts.semiBold,
    fontSize: 14,
    color: '#9CA3AF',
    paddingHorizontal: 20,
    paddingVertical: 12,
    textAlign: 'center',
  },
  divider: {
    height: 1,
    backgroundColor: colors.cloudGrey,
    marginHorizontal: 0,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  menuItemPressed: {
    backgroundColor: colors.cloudGrey,
  },
  menuItemText: {
    fontFamily: fonts.medium,
    fontSize: 15,
    color: colors.inkBlack,
  },
  menuItemDanger: {
    color: colors.error,
  },
})

import { Ionicons } from '@expo/vector-icons'
import { LinearGradient } from 'expo-linear-gradient'
import { useState } from 'react'
import {
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { useTranslation } from 'react-i18next'

import { colors } from '@/constants/colors'
import { fonts } from '@/constants/fonts'
import { LANGUAGES } from '@/constants/languages'
import { shadow } from '@/lib/shadow'
import { useAppStore } from '@/store/appStore'

// ─── Component ────────────────────────────────────────────────────────────────

interface Props {
  /** Tint colour for the trigger text and icon. Defaults to inkBlack. */
  tintColor?: string
}

export function LanguageDropdown({ tintColor = colors.inkBlack }: Props) {
  const { i18n } = useTranslation()
  const { setSelectedLanguage } = useAppStore()
  const [visible, setVisible] = useState(false)

  const currentLang =
    LANGUAGES.find((l) => l.id === i18n.language) ?? LANGUAGES[0]

  const handleSelect = (id: string) => {
    setSelectedLanguage(id)
    setVisible(false)
  }

  return (
    <>
      {/* ── Trigger ── */}
      <Pressable
        onPress={() => setVisible(true)}
        style={styles.trigger}
        hitSlop={8}
      >
        <Text style={[styles.triggerText, { color: tintColor }]}>
          {currentLang.nativeName}
        </Text>
        <Ionicons name="chevron-down" size={12} color={tintColor} />
      </Pressable>

      {/* ── Picker Modal ── */}
      <Modal
        visible={visible}
        transparent
        animationType="fade"
        onRequestClose={() => setVisible(false)}
      >
        <Pressable style={styles.backdrop} onPress={() => setVisible(false)}>
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>Select language</Text>
            <FlatList
              data={LANGUAGES}
              keyExtractor={(item) => item.id}
              renderItem={({ item, index }) => {
                const isSelected = item.id === i18n.language
                const isLast = index === LANGUAGES.length - 1
                if (isSelected) {
                  return (
                    <Pressable onPress={() => handleSelect(item.id)}>
                      <LinearGradient
                        colors={['#2962FF', '#00BFA5']}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 0 }}
                        style={styles.selectedRow}
                      >
                        <Text style={styles.selectedRowText}>
                          {item.nativeName}
                        </Text>
                        <Ionicons name="checkmark" size={16} color="#fff" />
                      </LinearGradient>
                    </Pressable>
                  )
                }
                return (
                  <>
                    <Pressable
                      onPress={() => handleSelect(item.id)}
                      style={styles.row}
                    >
                      <Text style={styles.rowText}>{item.nativeName}</Text>
                    </Pressable>
                    {!isLast && <View style={styles.sep} />}
                  </>
                )
              }}
              showsVerticalScrollIndicator={false}
            />
          </View>
        </Pressable>
      </Modal>
    </>
  )
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  trigger: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  triggerText: {
    fontFamily: fonts.medium,
    fontSize: 13,
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  sheet: {
    width: '100%',
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    paddingVertical: 8,
    overflow: 'hidden',
    ...shadow('#000', 0, 8, 20, 0.15, 10),
  },
  sheetTitle: {
    fontFamily: fonts.bold,
    fontSize: 16,
    color: colors.inkBlack,
    textAlign: 'center',
    paddingVertical: 12,
    paddingBottom: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.steelGrey,
    marginBottom: 4,
  },
  selectedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  selectedRowText: {
    fontFamily: fonts.semiBold,
    fontSize: 15,
    color: '#FFFFFF',
  },
  row: {
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  rowText: {
    fontFamily: fonts.medium,
    fontSize: 15,
    color: colors.inkBlack,
  },
  sep: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.steelGrey,
    marginHorizontal: 20,
  },
})

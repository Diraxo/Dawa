import { Ionicons } from '@expo/vector-icons'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FlatList, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'

import { colors } from '@/constants/colors'
import { COUNTRIES, getFlag } from '@/constants/countries'
import { fonts } from '@/constants/fonts'

export function CountryPickerModal({
  visible,
  selected,
  onSelect,
  onClose,
}: {
  visible: boolean
  selected: string
  onSelect: (name: string) => void
  onClose: () => void
}) {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')

  const filtered = query.trim()
    ? COUNTRIES.filter((c) => c.name.toLowerCase().includes(query.toLowerCase()))
    : COUNTRIES

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Pressable style={styles.backdrop} onPress={onClose} />
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <Text style={styles.title}>{t('country')}</Text>
          <View style={styles.searchRow}>
            <Ionicons name="search" size={16} color="#9CA3AF" />
            <TextInput
              style={styles.searchInput}
              placeholder={t('searchCountry')}
              placeholderTextColor="#9CA3AF"
              value={query}
              onChangeText={setQuery}
              autoCorrect={false}
              autoCapitalize="none"
            />
          </View>
          <FlatList
            data={filtered}
            keyExtractor={(item) => item.id}
            style={{ maxHeight: 360 }}
            renderItem={({ item }) => (
              <Pressable
                style={styles.item}
                onPress={() => { onSelect(item.name); onClose() }}
              >
                <Text style={styles.flag}>{getFlag(item.id)}</Text>
                <Text style={[styles.itemText, selected === item.name && styles.itemTextSel]}>
                  {item.name}
                </Text>
                {selected === item.name && (
                  <Ionicons name="checkmark" size={18} color={colors.tealGreen} />
                )}
              </Pressable>
            )}
          />
        </View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: {
    backgroundColor: colors.mistWhite,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 24,
    maxHeight: '75%',
  },
  handle: { width: 40, height: 4, backgroundColor: colors.steelGrey, borderRadius: 2, alignSelf: 'center', marginBottom: 12 },
  title: { fontFamily: fonts.bold, fontSize: 18, color: colors.inkBlack, marginBottom: 12 },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.cloudGrey,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.steelGrey,
    paddingHorizontal: 12,
    height: 44,
    marginBottom: 8,
  },
  searchInput: { flex: 1, fontFamily: fonts.regular, fontSize: 14, color: colors.inkBlack, padding: 0 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: colors.cloudGrey },
  flag: { fontSize: 20 },
  itemText: { flex: 1, fontFamily: fonts.regular, fontSize: 15, color: colors.inkBlack },
  itemTextSel: { fontFamily: fonts.semiBold, color: colors.tealGreen },
})

import { useEffect, useState } from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'

const DISCLAIMER_KEY = 'disclaimer_shown'

interface Props {
  dismissible: boolean
  onDismiss?: () => void
}

export default function MedicalDisclaimer({ dismissible, onDismiss }: Props) {
  const [visible, setVisible] = useState(!dismissible)

  useEffect(() => {
    if (!dismissible) return
    AsyncStorage.getItem(DISCLAIMER_KEY).then((value) => {
      if (!value) setVisible(true)
    })
  }, [dismissible])

  const handleDismiss = async () => {
    await AsyncStorage.setItem(DISCLAIMER_KEY, 'true')
    setVisible(false)
    onDismiss?.()
  }

  if (!visible) return null

  return (
    <View style={styles.container}>
      <Text style={styles.icon}>⚠️</Text>
      <Text style={styles.text}>
        Dawa consultations are not a substitute for emergency care. Call
        emergency services for life-threatening conditions.
      </Text>
      {dismissible && (
        <TouchableOpacity onPress={handleDismiss} style={styles.closeButton} hitSlop={8}>
          <Text style={styles.closeText}>✕</Text>
        </TouchableOpacity>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFF7ED',
    borderWidth: 1,
    borderColor: '#FED7AA',
    borderRadius: 12,
    padding: 16,
    gap: 10,
  },
  icon: {
    fontSize: 18,
    lineHeight: 22,
  },
  text: {
    flex: 1,
    fontFamily: 'Montserrat_400Regular',
    fontSize: 13,
    lineHeight: 20,
    color: '#92400E',
  },
  closeButton: {
    paddingLeft: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  closeText: {
    fontFamily: 'Montserrat_600SemiBold',
    fontSize: 14,
    color: '#92400E',
  },
})

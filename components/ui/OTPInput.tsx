import { useEffect, useRef, useState } from 'react'
import { StyleSheet, TextInput, View } from 'react-native'

import { colors } from '@/constants/colors'
import { fonts } from '@/constants/fonts'

type Props = {
  value: string[]
  onChange: (code: string[]) => void
  hasError?: boolean
  autoFocus?: boolean
}

export function OTPInput({ value, onChange, hasError = false, autoFocus = true }: Props) {
  const length = value.length
  const inputRefs = useRef<(TextInput | null)[]>([])
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null)

  useEffect(() => {
    if (autoFocus) {
      const t = setTimeout(() => inputRefs.current[0]?.focus(), 350)
      return () => clearTimeout(t)
    }
  }, [autoFocus])

  const handleChangeText = (text: string, index: number) => {
    const digit = text.replace(/[^0-9]/g, '').slice(-1)
    const next = [...value]
    next[index] = digit
    onChange(next)
    if (digit && index < length - 1) {
      inputRefs.current[index + 1]?.focus()
    }
  }

  const handleKeyPress = (key: string, index: number) => {
    if (key === 'Backspace' && !value[index] && index > 0) {
      const next = [...value]
      next[index - 1] = ''
      onChange(next)
      inputRefs.current[index - 1]?.focus()
    }
  }

  return (
    <View style={styles.row}>
      {value.map((digit, i) => (
        <TextInput
          key={i}
          ref={(r) => {
            inputRefs.current[i] = r
          }}
          style={[
            styles.box,
            focusedIndex === i && styles.boxFocused,
            !!digit && !hasError && styles.boxFilled,
            hasError && styles.boxError,
          ]}
          value={digit}
          onChangeText={(t) => handleChangeText(t, i)}
          onKeyPress={({ nativeEvent }) => handleKeyPress(nativeEvent.key, i)}
          onFocus={() => setFocusedIndex(i)}
          onBlur={() => setFocusedIndex(null)}
          keyboardType="number-pad"
          maxLength={1}
          selectTextOnFocus
          caretHidden
        />
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: 10,
  },
  box: {
    flex: 1,
    height: 64,
    borderWidth: 1.5,
    borderColor: colors.steelGrey,
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    fontSize: 24,
    fontFamily: fonts.bold,
    color: colors.inkBlack,
    textAlign: 'center',
  },
  boxFocused: {
    borderColor: colors.tealGreen,
    borderWidth: 2,
  },
  boxFilled: {
    borderColor: colors.tealGreen,
    borderWidth: 2,
  },
  boxError: {
    borderColor: colors.error,
    borderWidth: 2,
    backgroundColor: '#FFF5F5',
  },
})

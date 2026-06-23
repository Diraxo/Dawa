import { useEffect, useRef, useState } from 'react'
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native'

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
  const inputRef = useRef<TextInput>(null)
  const [focused, setFocused] = useState(false)

  useEffect(() => {
    if (autoFocus) {
      const t = setTimeout(() => inputRef.current?.focus(), 350)
      return () => clearTimeout(t)
    }
  }, [autoFocus])

  const handleChangeText = (text: string) => {
    const digits = text.replace(/[^0-9]/g, '').slice(0, length)
    const next = Array(length).fill('') as string[]
    for (let i = 0; i < digits.length; i++) next[i] = digits[i]
    onChange(next)
  }

  // First empty box index (cursor position)
  const cursorIdx = value.findIndex((d) => d === '')
  const activeCursor = cursorIdx === -1 ? length - 1 : cursorIdx

  return (
    <Pressable onPress={() => inputRef.current?.focus()} style={styles.row}>
      {/* Single hidden input — captures typing, paste, and keyboard autofill */}
      <TextInput
        ref={inputRef}
        value={value.join('')}
        onChangeText={handleChangeText}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        keyboardType="number-pad"
        maxLength={length}
        autoComplete="one-time-code"
        textContentType="oneTimeCode"
        style={styles.hidden}
        caretHidden
      />

      {value.map((digit, i) => (
        <View
          key={i}
          style={[
            styles.box,
            focused && i === activeCursor && styles.boxActive,
            !!digit && !hasError && styles.boxFilled,
            hasError && styles.boxError,
          ]}
        >
          <Text style={[styles.digit, hasError && styles.digitError]}>{digit}</Text>
        </View>
      ))}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  hidden: {
    position: 'absolute',
    width: 1,
    height: 1,
    opacity: 0,
  },
  box: {
    width: 46,
    height: 52,
    borderWidth: 1.5,
    borderColor: colors.steelGrey,
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  boxActive: {
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
  digit: {
    fontSize: 22,
    fontFamily: fonts.bold,
    color: colors.inkBlack,
  },
  digitError: {
    color: colors.error,
  },
})

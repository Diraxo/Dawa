import MaskedView from '@react-native-masked-view/masked-view'
import { LinearGradient } from 'expo-linear-gradient'
import { StyleSheet, Text, View } from 'react-native'

import { fonts } from '@/constants/fonts'

type Props = {
  size?: number
}

export function CareHubLogo({ size = 130 }: Props) {
  const scale = size / 130
  const fontSize = Math.round(64 * scale)
  const lineHeight = Math.round(72 * scale)
  const cMarginLeft = Math.round(-10 * scale)
  const borderRadius = Math.round(28 * scale)

  const letterStyle = { fontFamily: fonts.bold, fontSize, lineHeight }

  return (
    <View style={[styles.container, { width: size, height: size, borderRadius }]}>
      <View style={styles.lettersRow}>
        {/* D — blue gradient */}
        <MaskedView maskElement={<Text style={letterStyle}>D</Text>}>
          <LinearGradient
            colors={['#4D7AFF', '#1A4598']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
          >
            <Text style={[letterStyle, styles.transparent]}>D</Text>
          </LinearGradient>
        </MaskedView>

        {/* C — teal gradient, overlaps D */}
        <MaskedView
          style={{ marginLeft: cMarginLeft }}
          maskElement={<Text style={letterStyle}>C</Text>}
        >
          <LinearGradient
            colors={['#00E5FF', '#00BFA5']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
          >
            <Text style={[letterStyle, styles.transparent]}>C</Text>
          </LinearGradient>
        </MaskedView>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#12192C',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 10,
  },
  lettersRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  transparent: {
    opacity: 0,
  },
})

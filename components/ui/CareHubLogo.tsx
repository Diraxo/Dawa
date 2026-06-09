import MaskedView from '@react-native-masked-view/masked-view';
import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, Text, View } from 'react-native';

import { fonts } from '@/constants/fonts';

export function CareHubLogo() {
  return (
    <View style={styles.container}>
      <View style={styles.lettersRow}>
        {/* D — blue gradient */}
        <MaskedView maskElement={<Text style={styles.letter}>D</Text>}>
          <LinearGradient
            colors={['#4D7AFF', '#1A4598']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
          >
            <Text style={[styles.letter, styles.transparent]}>D</Text>
          </LinearGradient>
        </MaskedView>

        {/* C — teal gradient, overlaps D by 10 */}
        <MaskedView
          style={styles.cLetter}
          maskElement={<Text style={styles.letter}>C</Text>}
        >
          <LinearGradient
            colors={['#00E5FF', '#00BFA5']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
          >
            <Text style={[styles.letter, styles.transparent]}>C</Text>
          </LinearGradient>
        </MaskedView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: 130,
    height: 130,
    backgroundColor: '#12192C',
    borderRadius: 28,
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
  letter: {
    fontFamily: fonts.bold,
    fontSize: 64,
    lineHeight: 72,
  },
  cLetter: {
    marginLeft: -10,
  },
  transparent: {
    opacity: 0,
  },
});

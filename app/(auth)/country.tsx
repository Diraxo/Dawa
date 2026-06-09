import { StyleSheet, Text, View } from 'react-native';

import { fonts } from '@/constants/fonts';

export default function CountryScreen() {
  return (
    <View style={styles.root}>
      <Text style={styles.title}>Pick Your Country</Text>
      <Text style={styles.subtitle}>Coming soon...</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F5F7FA',
  },
  title: {
    fontFamily: fonts.bold,
    fontSize: 24,
    color: '#111827',
  },
  subtitle: {
    fontFamily: fonts.regular,
    fontSize: 16,
    color: '#6B7280',
    marginTop: 8,
  },
});

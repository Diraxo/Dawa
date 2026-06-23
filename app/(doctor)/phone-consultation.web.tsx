import { Ionicons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { colors } from '@/constants/colors'
import { fonts } from '@/constants/fonts'

export default function DoctorPhoneConsultationScreen() {
  const router = useRouter()
  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.center}>
        <View style={styles.iconCircle}>
          <Ionicons name="call-outline" size={48} color={colors.tealGreen} />
        </View>
        <Text style={styles.title}>Phone Calls Require the App</Text>
        <Text style={styles.body}>
          Phone consultations are available on the Dawa Android app. Please use the app to conduct phone calls with patients.
        </Text>
        <Pressable style={styles.btn} onPress={() => router.back()}>
          <Text style={styles.btnText}>Go Back</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.mistWhite },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, gap: 16 },
  iconCircle: {
    width: 96, height: 96, borderRadius: 48,
    backgroundColor: '#EFF6FF', alignItems: 'center', justifyContent: 'center',
    marginBottom: 8,
  },
  title: { fontFamily: fonts.bold, fontSize: 22, color: colors.inkBlack, textAlign: 'center' },
  body: { fontFamily: fonts.regular, fontSize: 15, color: '#6B7280', textAlign: 'center', lineHeight: 24 },
  btn: {
    marginTop: 8, height: 52, borderRadius: 16, paddingHorizontal: 32,
    backgroundColor: colors.careBlue, alignItems: 'center', justifyContent: 'center',
  },
  btnText: { fontFamily: fonts.bold, fontSize: 16, color: colors.mistWhite },
})

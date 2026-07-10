import { useAuth, useSignIn } from "@clerk/clerk-expo"
import { Ionicons } from "@expo/vector-icons"
import { LinearGradient } from "expo-linear-gradient"
import { useRouter } from "expo-router"
import { useRef, useState } from "react"
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { CareHubAlert } from "@/components/ui/CareHubAlert"
import { CareHubLogo } from "@/components/ui/CareHubLogo"
import { colors } from "@/constants/colors"
import { fonts } from "@/constants/fonts"
import { getAuthClient, supabase } from "@/lib/supabase"

export default function ResetPasswordScreen() {
  const router = useRouter()
  const { top, bottom } = useSafeAreaInsets()
  const { isLoaded, signIn, setActive } = useSignIn()
  const { getToken } = useAuth()

  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [successAlert, setSuccessAlert] = useState(false)
  const successTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const targetRouteRef = useRef<string>('/(auth)/role')

  const handleReset = async () => {
    if (!isLoaded || !signIn) return
    if (password.length < 8) {
      setError("Password must be at least 8 characters.")
      return
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match.")
      return
    }
    setLoading(true)
    setError("")
    try {
      const result = await signIn.resetPassword({ password })
      if (result.status === "complete" && result.createdSessionId) {
        await setActive!({ session: result.createdSessionId })
        try {
          const token = await getToken()
          const client = token ? getAuthClient(token) : supabase
          const { data } = await client
            .from("users")
            .select("role")
            .eq("clerk_id", result.createdUserId)
            .single()
          if (data?.role === "patient") targetRouteRef.current = "/(patient)/(tabs)/home"
          else if (data?.role === "doctor") targetRouteRef.current = "/(doctor)/(tabs)/home"
          else targetRouteRef.current = "/(auth)/role"
        } catch {
          targetRouteRef.current = "/(auth)/role"
        }
        setSuccessAlert(true)
        successTimerRef.current = setTimeout(() => {
          setSuccessAlert(false)
          router.replace(targetRouteRef.current as never)
        }, 2000)
      } else {
        setError("Failed to reset password. Please try again.")
      }
    } catch (err: any) {
      const code: string = err?.errors?.[0]?.code ?? ""
      const message: string = err?.errors?.[0]?.message ?? ""
      if (code === "resource_not_found" || message.toLowerCase().includes("no sign in was found")) {
        setError("This reset session has expired or is no longer valid. Please request a new reset code.")
      } else {
        setError(
          err?.errors?.[0]?.longMessage ??
            message ??
            "Failed to reset password. Please try again."
        )
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <CareHubAlert
        visible={successAlert}
        variant="success"
        title="Password Reset!"
        message="Your password has been reset successfully."
        buttons={[
          {
            text: "Continue",
            style: "primary",
            onPress: () => {
              if (successTimerRef.current) clearTimeout(successTimerRef.current)
              setSuccessAlert(false)
              router.replace(targetRouteRef.current as never)
            },
          },
        ]}
      />

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <ScrollView
          contentContainerStyle={[
            styles.scroll,
            { paddingTop: top + 8, paddingBottom: Math.max(bottom, 28) },
          ]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.topNav}>
            <Pressable
              onPress={() => router.canGoBack() ? router.back() : router.replace("/(auth)/sign-in" as never)}
              hitSlop={8}
            >
              <Ionicons name="chevron-back" size={24} color={colors.inkBlack} />
            </Pressable>
          </View>

          <View style={styles.logoRow}>
            <CareHubLogo size={68} variant="dark" />
            <Text style={styles.brandName}>
              DA<Text style={styles.brandHub}>WA</Text>
            </Text>
          </View>

          <Text style={styles.title}>New Password</Text>
          <Text style={styles.subtitle}>Choose a strong password for your account.</Text>

          <View style={styles.form}>
            <View style={styles.fieldGroup}>
              <View style={[styles.inputRow, styles.inputRowWithToggle]}>
                <Ionicons name="lock-closed-outline" size={20} color="#9CA3AF" style={styles.icon} />
                <TextInput
                  style={[styles.input, styles.inputFlex]}
                  placeholder="New password"
                  placeholderTextColor="#9CA3AF"
                  value={password}
                  onChangeText={(v) => { setPassword(v); setError("") }}
                  secureTextEntry={!showPassword}
                  autoCapitalize="none"
                  returnKeyType="next"
                />
                <Pressable onPress={() => setShowPassword(p => !p)} hitSlop={12} style={styles.eyeBtn}>
                  <Ionicons
                    name={showPassword ? "eye-off-outline" : "eye-outline"}
                    size={20}
                    color="#9CA3AF"
                  />
                </Pressable>
              </View>
              <Text style={styles.hintText}>At least 8 characters</Text>
            </View>

            <View style={styles.fieldGroup}>
              <View style={[styles.inputRow, styles.inputRowWithToggle]}>
                <Ionicons name="lock-closed-outline" size={20} color="#9CA3AF" style={styles.icon} />
                <TextInput
                  style={[styles.input, styles.inputFlex]}
                  placeholder="Confirm new password"
                  placeholderTextColor="#9CA3AF"
                  value={confirmPassword}
                  onChangeText={(v) => { setConfirmPassword(v); setError("") }}
                  secureTextEntry={!showConfirm}
                  autoCapitalize="none"
                  returnKeyType="done"
                  onSubmitEditing={handleReset}
                />
                <Pressable onPress={() => setShowConfirm(p => !p)} hitSlop={12} style={styles.eyeBtn}>
                  <Ionicons
                    name={showConfirm ? "eye-off-outline" : "eye-outline"}
                    size={20}
                    color="#9CA3AF"
                  />
                </Pressable>
              </View>
            </View>

            {!!error && <Text style={styles.errorText}>{error}</Text>}

            <Pressable
              onPress={handleReset}
              disabled={loading || !password || !confirmPassword}
              style={[styles.btnWrap, (loading || !password || !confirmPassword) && styles.dimmed]}
            >
              <LinearGradient
                colors={["#2962FF", "#00BFA5"]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.btn}
              >
                {loading ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <Text style={styles.btnText}>Reset Password</Text>
                )}
              </LinearGradient>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: "#FFFFFF" },
  scroll: { flexGrow: 1, backgroundColor: "#FFFFFF", paddingHorizontal: 24 },

  topNav: { flexDirection: "row", alignItems: "center", paddingVertical: 10 },

  logoRow: { alignItems: "center", marginTop: 12, marginBottom: 28 },
  brandName: {
    fontFamily: fonts.bold, fontSize: 28, color: colors.inkBlack,
    letterSpacing: 1.5, marginTop: 8,
  },
  brandHub: { color: colors.tealGreen },

  title: {
    fontFamily: fonts.bold, fontSize: 30, color: colors.inkBlack,
    lineHeight: 36, textAlign: "center", marginBottom: 10,
  },
  subtitle: {
    fontFamily: fonts.regular, fontSize: 14, color: "#6B7280",
    lineHeight: 22, textAlign: "center", marginBottom: 28,
  },

  form: { marginTop: 8 },
  fieldGroup: { marginBottom: 22 },

  inputRow: {
    flexDirection: "row", alignItems: "center",
    borderBottomWidth: 1.5, borderBottomColor: colors.steelGrey, paddingBottom: 10,
  },
  inputRowWithToggle: { borderBottomWidth: 1.5, borderBottomColor: colors.steelGrey },
  icon: { marginRight: 10 },
  input: {
    flex: 1, fontFamily: fonts.regular, fontSize: 15,
    color: colors.inkBlack, height: 28, paddingVertical: 0,
  },
  inputFlex: { flex: 1 },
  eyeBtn: { paddingLeft: 8, paddingVertical: 2 },
  hintText: { fontFamily: fonts.regular, fontSize: 12, color: "#9CA3AF", marginTop: 5, marginLeft: 2 },

  errorText: {
    fontFamily: fonts.regular, fontSize: 12, color: colors.error,
    marginTop: 6, marginBottom: 4, lineHeight: 18,
  },

  btnWrap: { borderRadius: 16, overflow: "hidden", marginTop: 6 },
  btn: { height: 52, alignItems: "center", justifyContent: "center" },
  btnText: { fontFamily: fonts.bold, fontSize: 16, color: "#FFFFFF" },
  dimmed: { opacity: 0.5 },
})

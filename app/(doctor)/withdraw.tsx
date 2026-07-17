import { useAuth, useUser } from '@clerk/clerk-expo'
import { Ionicons } from '@expo/vector-icons'
import { LinearGradient } from 'expo-linear-gradient'
import { useRouter } from 'expo-router'
import { useEffect, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { colors } from '@/constants/colors'
import { fonts } from '@/constants/fonts'
import { gradients } from '@/constants/gradients'
import { shadow } from '@/lib/shadow'
import { getAuthClient, supabase } from '@/lib/supabase'

interface WithdrawalRecord {
  id: string
  amount: number
  status: string
  bank_details: string | null
  requested_at: string
}

const STATUS_COLORS: Record<string, string> = {
  pending:  colors.warning,
  approved: colors.tealGreen,
  rejected: colors.error,
  paid:     colors.careBlue,
}

const STATUS_ICONS: Record<string, React.ComponentProps<typeof Ionicons>['name']> = {
  pending:  'time-outline',
  approved: 'checkmark-circle-outline',
  rejected: 'close-circle-outline',
  paid:     'wallet-outline',
}

export default function WithdrawScreen() {
  const router = useRouter()
  const { getToken, userId } = useAuth()
  const { user } = useUser()

  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [availableBalance, setAvailableBalance] = useState(0)
  const [history, setHistory] = useState<WithdrawalRecord[]>([])
  const [tab, setTab] = useState<'request' | 'history'>('request')
  const [dbUserId, setDbUserId] = useState<string | null>(null)

  const [amount, setAmount] = useState('')
  const [bankName, setBankName] = useState('')
  const [accountNumber, setAccountNumber] = useState('')
  const [accountHolder, setAccountHolder] = useState(user?.fullName ?? '')

  useEffect(() => {
    load()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId])

  // Live-sync admin approve/reject/paid actions on this doctor's withdrawals —
  // without this, status only updated after leaving and re-entering this screen.
  useEffect(() => {
    if (!dbUserId) return
    const channel = supabase
      .channel(`doctor-withdrawals-${dbUserId}-${Date.now()}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'withdrawals', filter: `doctor_id=eq.${dbUserId}` },
        () => load()
      )
      .subscribe()
    return () => { supabase.removeChannel(channel) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dbUserId])

  async function load() {
    if (!userId) return
    try {
      const token = await getToken()
      if (!token) return
      const client = getAuthClient(token)

      const [userRes, totalRes, withdrawnRes, historyRes] = await Promise.all([
        client.from('users').select('id').eq('clerk_id', userId).single(),
        client.from('consultations').select('doctor_amount').eq('status', 'completed'),
        client.from('withdrawals').select('amount').in('status', ['pending', 'approved', 'paid']),
        client.from('withdrawals').select('id, amount, status, bank_details, requested_at').order('requested_at', { ascending: false }),
      ])

      if (userRes.data?.id) setDbUserId(userRes.data.id)
      const totalEarned = (totalRes.data ?? []).reduce((s, r: any) => s + (Number(r.doctor_amount) || 0), 0)
      const totalWithdrawn = (withdrawnRes.data ?? []).reduce((s, r: any) => s + (Number(r.amount) || 0), 0)
      setAvailableBalance(Math.max(0, totalEarned - totalWithdrawn))
      setHistory((historyRes.data ?? []) as WithdrawalRecord[])
    } finally {
      setLoading(false)
    }
  }

  async function handleSubmit() {
    const numAmount = Number(amount)
    if (!numAmount || numAmount <= 0) {
      Alert.alert('Invalid Amount', 'Please enter a valid amount to withdraw.')
      return
    }
    if (numAmount > availableBalance) {
      Alert.alert('Insufficient Balance', `You can withdraw up to ETB ${availableBalance.toLocaleString()}.`)
      return
    }
    if (!bankName.trim() || !accountNumber.trim() || !accountHolder.trim()) {
      Alert.alert('Missing Details', 'Please fill in all bank details.')
      return
    }

    setSubmitting(true)
    try {
      const token = await getToken()
      if (!token || !userId) throw new Error('Not authenticated')
      const client = getAuthClient(token)

      const { data: userData } = await client
        .from('users')
        .select('id')
        .eq('clerk_id', userId)
        .single()
      if (!userData) throw new Error('User not found')

      const { error } = await client.from('withdrawals').insert({
        doctor_id:    userData.id,
        amount:       numAmount,
        status:       'pending',
        bank_details: JSON.stringify({ bank_name: bankName.trim(), account_number: accountNumber.trim(), account_holder: accountHolder.trim() }),
        requested_at: new Date().toISOString(),
      })

      if (error) throw error

      Alert.alert('Request Submitted', 'Your withdrawal request has been submitted. Our team will process it within 1–3 business days.', [
        { text: 'OK', onPress: () => { setAmount(''); setBankName(''); setAccountNumber(''); setTab('history'); load() } },
      ])
    } catch (err: any) {
      Alert.alert('Error', err?.message ?? 'Could not submit withdrawal. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  const parseBankDetails = (raw: string | null) => {
    if (!raw) return null
    try { return JSON.parse(raw) } catch { return null }
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.6 }]} hitSlop={10}>
          <Ionicons name="chevron-back" size={26} color={colors.inkBlack} />
        </Pressable>
        <Text style={styles.headerTitle}>Withdraw Earnings</Text>
        <View style={{ width: 36 }} />
      </View>

      {loading ? (
        <ActivityIndicator color={colors.careBlue} style={{ marginTop: 60 }} />
      ) : (
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

            {/* Balance card */}
            <LinearGradient colors={gradients.hero} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.balanceCard}>
              <Text style={styles.balanceLabel}>Available Balance</Text>
              <Text style={styles.balanceAmount}>ETB {availableBalance.toLocaleString()}</Text>
              <Text style={styles.balanceSub}>After pending withdrawals</Text>
            </LinearGradient>

            {/* Tab switcher */}
            <View style={styles.tabRow}>
              <Pressable style={[styles.tabBtn, tab === 'request' && styles.tabBtnActive]} onPress={() => setTab('request')}>
                <Text style={[styles.tabText, tab === 'request' && styles.tabTextActive]}>New Request</Text>
              </Pressable>
              <Pressable style={[styles.tabBtn, tab === 'history' && styles.tabBtnActive]} onPress={() => setTab('history')}>
                <Text style={[styles.tabText, tab === 'history' && styles.tabTextActive]}>History</Text>
              </Pressable>
            </View>

            {tab === 'request' ? (
              <View style={styles.formCard}>
                <Text style={styles.formTitle}>Withdrawal Details</Text>

                <Text style={styles.fieldLabel}>Amount (ETB)</Text>
                <TextInput
                  style={styles.input}
                  value={amount}
                  onChangeText={setAmount}
                  placeholder={`Max ETB ${availableBalance.toLocaleString()}`}
                  placeholderTextColor="#9CA3AF"
                  keyboardType="numeric"
                />

                <Text style={styles.fieldLabel}>Bank Name</Text>
                <TextInput
                  style={styles.input}
                  value={bankName}
                  onChangeText={setBankName}
                  placeholder="e.g. Commercial Bank of Ethiopia"
                  placeholderTextColor="#9CA3AF"
                />

                <Text style={styles.fieldLabel}>Account Number</Text>
                <TextInput
                  style={styles.input}
                  value={accountNumber}
                  onChangeText={setAccountNumber}
                  placeholder="Your bank account number"
                  placeholderTextColor="#9CA3AF"
                  keyboardType="numeric"
                />

                <Text style={styles.fieldLabel}>Account Holder Name</Text>
                <TextInput
                  style={styles.input}
                  value={accountHolder}
                  onChangeText={setAccountHolder}
                  placeholder="Name on the account"
                  placeholderTextColor="#9CA3AF"
                />

                <View style={styles.noticeRow}>
                  <Ionicons name="information-circle-outline" size={16} color={colors.careBlue} />
                  <Text style={styles.noticeText}>Processing takes 1–3 business days. We'll notify you when your funds are transferred.</Text>
                </View>

                <Pressable
                  onPress={handleSubmit}
                  disabled={submitting || availableBalance === 0}
                  style={({ pressed }) => [styles.submitWrap, pressed && { opacity: 0.88 }, (submitting || availableBalance === 0) && styles.submitDisabled]}
                >
                  <LinearGradient colors={gradients.interactive} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.submitBtn}>
                    {submitting
                      ? <ActivityIndicator color={colors.mistWhite} />
                      : <><Ionicons name="wallet-outline" size={18} color={colors.mistWhite} /><Text style={styles.submitText}>Submit Withdrawal Request</Text></>
                    }
                  </LinearGradient>
                </Pressable>
              </View>
            ) : (
              <View>
                {history.length === 0 ? (
                  <View style={styles.emptyWrap}>
                    <Ionicons name="time-outline" size={40} color={colors.steelGrey} />
                    <Text style={styles.emptyText}>No withdrawal requests yet</Text>
                  </View>
                ) : (
                  history.map(w => {
                    const bank = parseBankDetails(w.bank_details)
                    const statusColor = STATUS_COLORS[w.status] ?? '#6B7280'
                    return (
                      <View key={w.id} style={styles.historyCard}>
                        <View style={styles.historyTop}>
                          <View style={[styles.historyIconWrap, { backgroundColor: `${statusColor}18` }]}>
                            <Ionicons name={STATUS_ICONS[w.status] ?? 'cash-outline'} size={20} color={statusColor} />
                          </View>
                          <View style={styles.historyInfo}>
                            <Text style={styles.historyAmount}>ETB {Number(w.amount).toLocaleString()}</Text>
                            <Text style={styles.historyDate}>{new Date(w.requested_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</Text>
                          </View>
                          <View style={[styles.statusBadge, { backgroundColor: `${statusColor}18` }]}>
                            <Text style={[styles.statusText, { color: statusColor }]}>{w.status}</Text>
                          </View>
                        </View>
                        {bank && (
                          <Text style={styles.historyBank}>{bank.bank_name} · ···{String(bank.account_number).slice(-4)}</Text>
                        )}
                      </View>
                    )
                  })
                )}
              </View>
            )}

            <View style={{ height: 40 }} />
          </ScrollView>
        </KeyboardAvoidingView>
      )}
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.cloudGrey },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12,
  },
  backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontFamily: fonts.bold, fontSize: 18, color: colors.inkBlack },

  scroll: { paddingHorizontal: 20, paddingTop: 8 },

  balanceCard: {
    borderRadius: 20, padding: 28, alignItems: 'center', marginBottom: 20,
    ...shadow(colors.careBlue, 0, 4, 12, 0.22, 5),
  },
  balanceLabel: { fontFamily: fonts.regular, fontSize: 14, color: 'rgba(255,255,255,0.8)', marginBottom: 6 },
  balanceAmount: { fontFamily: fonts.bold, fontSize: 36, color: colors.mistWhite, marginBottom: 4 },
  balanceSub: { fontFamily: fonts.regular, fontSize: 12, color: 'rgba(255,255,255,0.65)' },

  tabRow: {
    flexDirection: 'row', gap: 8, marginBottom: 16,
    backgroundColor: colors.mistWhite, borderRadius: 14, padding: 4,
    ...shadow('#000', 0, 1, 4, 0.04, 1),
  },
  tabBtn: { flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: 'center' },
  tabBtnActive: { backgroundColor: colors.careBlue },
  tabText: { fontFamily: fonts.semiBold, fontSize: 14, color: '#6B7280' },
  tabTextActive: { color: colors.mistWhite },

  formCard: {
    backgroundColor: colors.mistWhite, borderRadius: 20, padding: 20, gap: 4,
    ...shadow('#000', 0, 1, 6, 0.06, 2),
  },
  formTitle: { fontFamily: fonts.bold, fontSize: 16, color: colors.inkBlack, marginBottom: 12 },
  fieldLabel: { fontFamily: fonts.semiBold, fontSize: 13, color: '#374151', marginTop: 10, marginBottom: 6 },
  input: {
    height: 48, borderRadius: 12, borderWidth: 1.5, borderColor: colors.steelGrey,
    paddingHorizontal: 14, fontFamily: fonts.regular, fontSize: 15, color: colors.inkBlack,
    backgroundColor: colors.cloudGrey,
  },
  noticeRow: {
    flexDirection: 'row', gap: 8, alignItems: 'flex-start',
    backgroundColor: `${colors.careBlue}10`, borderRadius: 10, padding: 12, marginTop: 12,
  },
  noticeText: { fontFamily: fonts.regular, fontSize: 12, color: colors.careBlue, flex: 1, lineHeight: 18 },

  submitWrap: { borderRadius: 14, overflow: 'hidden', marginTop: 20 },
  submitBtn: { height: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
  submitText: { fontFamily: fonts.bold, fontSize: 16, color: colors.mistWhite },
  submitDisabled: { opacity: 0.5 },

  emptyWrap: { alignItems: 'center', paddingTop: 48, gap: 12 },
  emptyText: { fontFamily: fonts.semiBold, fontSize: 15, color: '#6B7280' },

  historyCard: {
    backgroundColor: colors.mistWhite, borderRadius: 16, padding: 16, marginBottom: 12,
    ...shadow('#000', 0, 1, 5, 0.05, 2),
  },
  historyTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  historyIconWrap: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  historyInfo: { flex: 1 },
  historyAmount: { fontFamily: fonts.bold, fontSize: 16, color: colors.inkBlack },
  historyDate: { fontFamily: fonts.regular, fontSize: 12, color: '#6B7280', marginTop: 2 },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  statusText: { fontFamily: fonts.semiBold, fontSize: 12, textTransform: 'capitalize' },
  historyBank: { fontFamily: fonts.regular, fontSize: 12, color: '#9CA3AF', marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: colors.cloudGrey },
})

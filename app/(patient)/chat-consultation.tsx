import { Ionicons } from '@expo/vector-icons'
import { LinearGradient } from 'expo-linear-gradient'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useRef, useState } from 'react'
import {
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { colors } from '@/constants/colors'
import { fonts } from '@/constants/fonts'

type Message = {
  id: string
  text: string
  sender: 'patient' | 'doctor'
  time: string
}

const now = new Date()
const fmt = (offset: number) => {
  const d = new Date(now.getTime() - offset * 60000)
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
}

const INITIAL_MESSAGES: Message[] = [
  { id: '1', text: 'Hello! I am ready for our consultation. How can I help you today?', sender: 'doctor', time: fmt(5) },
  { id: '2', text: 'Hi doctor, I have been having headaches for the past 3 days.', sender: 'patient', time: fmt(4) },
  { id: '3', text: 'I see. Can you describe the headache? Is it throbbing, constant, or pressure-like?', sender: 'doctor', time: fmt(3) },
  { id: '4', text: 'It feels like pressure behind my eyes, especially in the morning.', sender: 'patient', time: fmt(2) },
]

export default function ChatConsultationScreen() {
  const { doctorId, doctorName } = useLocalSearchParams<{ doctorId: string; doctorName: string }>()
  const router = useRouter()
  const listRef = useRef<FlatList>(null)
  const [messages, setMessages] = useState<Message[]>(INITIAL_MESSAGES)
  const [inputText, setInputText] = useState('')

  const sendMessage = () => {
    const text = inputText.trim()
    if (!text) return
    const newMsg: Message = {
      id: Date.now().toString(),
      text,
      sender: 'patient',
      time: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
    }
    setMessages(prev => [...prev, newMsg])
    setInputText('')
    setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100)
  }

  const handleEndConsultation = () => {
    Alert.alert('End Consultation', 'Are you sure you want to end this consultation?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'End',
        style: 'destructive',
        onPress: () =>
          router.replace({
            pathname: '/(patient)/consultation-summary',
            params: { doctorId, doctorName, consultationType: 'chat' },
          }),
      },
    ])
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.doctorInfo}>
          <View style={styles.avatarWrap}>
            <Ionicons name="person" size={22} color={colors.steelGrey} />
            <View style={styles.onlineDot} />
          </View>
          <View>
            <Text style={styles.doctorName}>{doctorName ?? 'Doctor'}</Text>
            <View style={styles.liveRow}>
              <View style={styles.liveDot} />
              <Text style={styles.liveText}>Live Consultation</Text>
            </View>
          </View>
        </View>
        <Pressable
          onPress={handleEndConsultation}
          style={({ pressed }) => [styles.endBtn, pressed && { opacity: 0.8 }]}
        >
          <Text style={styles.endBtnText}>End</Text>
        </Pressable>
      </View>

      {/* Messages */}
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={0}
      >
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={item => item.id}
          contentContainerStyle={styles.messageList}
          showsVerticalScrollIndicator={false}
          renderItem={({ item }) => (
            <View style={[styles.bubble, item.sender === 'patient' ? styles.bubbleRight : styles.bubbleLeft]}>
              {item.sender === 'doctor' && (
                <View style={styles.bubbleAvatar}>
                  <Ionicons name="person" size={14} color={colors.steelGrey} />
                </View>
              )}
              <View style={[styles.bubbleContent, item.sender === 'patient' ? styles.bubbleContentRight : styles.bubbleContentLeft]}>
                <Text style={[styles.bubbleText, item.sender === 'patient' && styles.bubbleTextPatient]}>
                  {item.text}
                </Text>
                <Text style={[styles.bubbleTime, item.sender === 'patient' && styles.bubbleTimePatient]}>
                  {item.time}
                </Text>
              </View>
            </View>
          )}
        />

        {/* Input bar */}
        <View style={styles.inputBar}>
          <Pressable style={styles.attachBtn}>
            <Ionicons name="attach" size={22} color="#9CA3AF" />
          </Pressable>
          <TextInput
            style={styles.textInput}
            placeholder="Type a message..."
            placeholderTextColor="#9CA3AF"
            value={inputText}
            onChangeText={setInputText}
            multiline
            maxLength={500}
          />
          <Pressable
            onPress={sendMessage}
            disabled={!inputText.trim()}
            style={({ pressed }) => [styles.sendBtnWrap, pressed && { opacity: 0.8 }]}
          >
            <LinearGradient
              colors={!inputText.trim() ? ['#D1D5DB', '#D1D5DB'] : ['#2962FF', '#00BFA5']}
              start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
              style={styles.sendBtn}
            >
              <Ionicons name="send" size={18} color={colors.mistWhite} />
            </LinearGradient>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.cloudGrey },
  flex: { flex: 1 },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12,
    backgroundColor: colors.mistWhite,
    borderBottomWidth: 1, borderBottomColor: colors.cloudGrey,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06, shadowRadius: 4, elevation: 2,
  },
  doctorInfo: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  avatarWrap: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: colors.cloudGrey,
    alignItems: 'center', justifyContent: 'center',
    position: 'relative',
  },
  onlineDot: {
    position: 'absolute', bottom: 1, right: 1,
    width: 12, height: 12, borderRadius: 6,
    backgroundColor: colors.success, borderWidth: 2, borderColor: colors.mistWhite,
  },
  doctorName: { fontFamily: fonts.semiBold, fontSize: 15, color: colors.inkBlack },
  liveRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.error },
  liveText: { fontFamily: fonts.regular, fontSize: 12, color: colors.error },
  endBtn: {
    backgroundColor: colors.error, borderRadius: 10,
    paddingHorizontal: 16, paddingVertical: 8,
  },
  endBtnText: { fontFamily: fonts.bold, fontSize: 13, color: colors.mistWhite },

  // Messages
  messageList: { padding: 16, gap: 12 },
  bubble: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  bubbleRight: { justifyContent: 'flex-end' },
  bubbleLeft: { justifyContent: 'flex-start' },
  bubbleAvatar: {
    width: 30, height: 30, borderRadius: 15,
    backgroundColor: colors.cloudGrey,
    alignItems: 'center', justifyContent: 'center',
    flexShrink: 0,
  },
  bubbleContent: { maxWidth: '72%', borderRadius: 16, padding: 12 },
  bubbleContentLeft: { backgroundColor: colors.mistWhite, borderBottomLeftRadius: 4 },
  bubbleContentRight: { backgroundColor: colors.tealGreen, borderBottomRightRadius: 4 },
  bubbleText: { fontFamily: fonts.regular, fontSize: 14, color: colors.inkBlack, lineHeight: 20 },
  bubbleTextPatient: { color: colors.mistWhite },
  bubbleTime: { fontFamily: fonts.regular, fontSize: 11, color: '#9CA3AF', marginTop: 4, textAlign: 'right' },
  bubbleTimePatient: { color: 'rgba(255,255,255,0.7)' },

  // Input
  inputBar: {
    flexDirection: 'row', alignItems: 'flex-end', gap: 8,
    paddingHorizontal: 12, paddingVertical: 10,
    backgroundColor: colors.mistWhite,
    borderTopWidth: 1, borderTopColor: colors.cloudGrey,
  },
  attachBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  textInput: {
    flex: 1, backgroundColor: colors.cloudGrey, borderRadius: 20,
    paddingHorizontal: 16, paddingVertical: 10,
    fontFamily: fonts.regular, fontSize: 14, color: colors.inkBlack,
    maxHeight: 100,
  },
  sendBtnWrap: { borderRadius: 20, overflow: 'hidden' },
  sendBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
})

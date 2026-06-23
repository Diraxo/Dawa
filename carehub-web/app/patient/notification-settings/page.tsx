'use client'

import { useEffect, useState } from 'react'
import { useUser, useAuth } from '@clerk/nextjs'
import { getAuthClient } from '@/lib/supabase'

type PrefKey =
  | 'consultation_request'
  | 'messages'
  | 'appointment_reminder'
  | 'consultation_summary'
  | 'promotions'
  | 'health_tips'
  | 'account'

interface Prefs {
  consultation_request: boolean
  messages: boolean
  appointment_reminder: boolean
  consultation_summary: boolean
  promotions: boolean
  health_tips: boolean
  account: boolean
}

const DEFAULTS: Prefs = {
  consultation_request: true,
  messages: true,
  appointment_reminder: true,
  consultation_summary: true,
  promotions: false,
  health_tips: false,
  account: true,
}

const SECTIONS = [
  {
    title: 'Consultations',
    items: [
      { key: 'consultation_request' as PrefKey, icon: '🩺', title: 'Consultation Requests', subtitle: 'New consultation updates and confirmations' },
      { key: 'messages' as PrefKey, icon: '💬', title: 'New Messages', subtitle: 'Messages from your doctors' },
      { key: 'appointment_reminder' as PrefKey, icon: '⏰', title: 'Appointment Reminders', subtitle: 'Reminders before scheduled sessions' },
      { key: 'consultation_summary' as PrefKey, icon: '📋', title: 'Consultation Summary', subtitle: 'Summary ready after each session' },
    ],
  },
  {
    title: 'Content & Marketing',
    items: [
      { key: 'promotions' as PrefKey, icon: '🎁', title: 'Promotions & Offers', subtitle: 'Discounts and special health offers' },
      { key: 'health_tips' as PrefKey, icon: '💡', title: 'Health Tips', subtitle: 'Personalized wellness recommendations' },
    ],
  },
  {
    title: 'Security',
    items: [
      { key: 'account' as PrefKey, icon: '🔒', title: 'Account & Security', subtitle: 'Login alerts and security updates' },
    ],
  },
]

function Toggle({ enabled, onToggle }: { enabled: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      className={`relative w-12 h-6 rounded-full transition-colors flex-shrink-0 ${enabled ? 'bg-teal-green' : 'bg-steel-grey'}`}
    >
      <div className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-transform ${enabled ? 'translate-x-7' : 'translate-x-1'}`} />
    </button>
  )
}

export default function PatientNotificationSettingsPage() {
  const { user } = useUser()
  const { getToken } = useAuth()
  const [userId, setUserId] = useState<string | null>(null)
  const [prefs, setPrefs] = useState<Prefs>(DEFAULTS)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  // Load preferences from Supabase
  useEffect(() => {
    if (!user) return
    async function load() {
      const token = await getToken()
      if (!token) return
      const client = getAuthClient(token)

      const { data: ud } = await client.from('users').select('id').eq('clerk_id', user!.id).single()
      if (!ud) { setLoading(false); return }
      setUserId((ud as any).id)

      const { data } = await client
        .from('notification_preferences')
        .select('consultation_request, messages, appointment_reminder, consultation_summary, promotions, health_tips, account')
        .eq('user_id', (ud as any).id)
        .maybeSingle()

      if (data) {
        setPrefs({
          consultation_request: (data as any).consultation_request ?? DEFAULTS.consultation_request,
          messages: (data as any).messages ?? DEFAULTS.messages,
          appointment_reminder: (data as any).appointment_reminder ?? DEFAULTS.appointment_reminder,
          consultation_summary: (data as any).consultation_summary ?? DEFAULTS.consultation_summary,
          promotions: (data as any).promotions ?? DEFAULTS.promotions,
          health_tips: (data as any).health_tips ?? DEFAULTS.health_tips,
          account: (data as any).account ?? DEFAULTS.account,
        })
      }
      setLoading(false)
    }
    load()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user])

  async function savePrefs(next: Prefs) {
    if (!userId) return
    setSaving(true)
    try {
      const token = await getToken()
      if (!token) return
      const client = getAuthClient(token)
      await client
        .from('notification_preferences')
        .upsert({ user_id: userId, ...next }, { onConflict: 'user_id' })
    } catch (err) {
      console.error('[NotifSettings] save error:', err)
    } finally {
      setSaving(false)
    }
  }

  function toggleOne(key: PrefKey) {
    setPrefs(prev => {
      const next = { ...prev, [key]: !prev[key] }
      savePrefs(next)
      return next
    })
  }

  const allEnabled = Object.values(prefs).every(Boolean)

  function toggleAll() {
    const next = Object.fromEntries(
      (Object.keys(prefs) as PrefKey[]).map(k => [k, !allEnabled])
    ) as Prefs
    setPrefs(next)
    savePrefs(next)
  }

  return (
    <div className="p-8 max-w-2xl">
      <div className="mb-8">
        <h1 className="font-montserrat font-black text-3xl text-ink-black">Notifications</h1>
        <p className="text-ink-black/50 text-sm mt-1">Control which notifications you receive</p>
      </div>

      {loading ? (
        <div className="flex flex-col gap-3">
          {[1, 2, 3].map(i => <div key={i} className="h-16 shimmer-bg rounded-2xl" />)}
        </div>
      ) : (
        <>
          {/* Master toggle */}
          <div className="card p-5 mb-6 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-[#EFF6FF] flex items-center justify-center text-xl flex-shrink-0">🔔</div>
              <div>
                <p className="font-montserrat font-bold text-sm text-ink-black">All Notifications</p>
                <p className="text-xs text-ink-black/40 mt-0.5">
                  {allEnabled ? 'All notifications enabled' : 'Some notifications disabled'}
                </p>
              </div>
            </div>
            <Toggle enabled={allEnabled} onToggle={toggleAll} />
          </div>

          {/* Sections */}
          <div className="flex flex-col gap-5">
            {SECTIONS.map(section => (
              <div key={section.title}>
                <p className="text-[11px] font-bold text-ink-black/40 uppercase tracking-wider mb-2 ml-1">{section.title}</p>
                <div className="card divide-y divide-cloud-grey">
                  {section.items.map(item => (
                    <div key={item.key} className="flex items-center gap-4 p-4">
                      <div className="w-9 h-9 rounded-xl bg-cloud-grey flex items-center justify-center text-lg flex-shrink-0">{item.icon}</div>
                      <div className="flex-1 min-w-0">
                        <p className="font-montserrat font-semibold text-sm text-ink-black">{item.title}</p>
                        <p className="text-xs text-ink-black/40 mt-0.5">{item.subtitle}</p>
                      </div>
                      <Toggle enabled={prefs[item.key]} onToggle={() => toggleOne(item.key)} />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <p className="text-xs text-ink-black/30 text-center mt-6">
            {saving ? 'Saving…' : 'Preferences saved automatically.'}
          </p>
        </>
      )}
    </div>
  )
}

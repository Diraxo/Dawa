'use client'

import { useEffect, useState } from 'react'
import { useUser, useAuth } from '@clerk/nextjs'
import { getAuthClient } from '@/lib/supabase'

type PrefKey = 'new_requests' | 'patient_messages' | 'consultation_updates' | 'earnings' | 'reviews' | 'security' | 'announcements'

// Maps this screen's keys to notification_preferences columns.
// new_requests/patient_messages/security reuse the patient-side columns
// (same meaning); the rest are doctor-only columns added in migration 053.
const COLUMN: Record<PrefKey, string> = {
  new_requests: 'consultation_request',
  patient_messages: 'messages',
  consultation_updates: 'consultation_update',
  earnings: 'earnings',
  reviews: 'reviews',
  security: 'account',
  announcements: 'announcements',
}

const DEFAULTS: Record<PrefKey, boolean> = {
  new_requests: true,
  patient_messages: true,
  consultation_updates: true,
  earnings: true,
  reviews: true,
  security: true,
  announcements: false,
}

const SECTIONS = [
  {
    title: 'Consultations',
    items: [
      { key: 'new_requests' as PrefKey, icon: '🩺', title: 'New Consultation Requests', subtitle: 'Get notified when a patient books with you' },
      { key: 'patient_messages' as PrefKey, icon: '💬', title: 'Patient Messages', subtitle: 'New messages during active consultations' },
      { key: 'consultation_updates' as PrefKey, icon: '🔔', title: 'Consultation Updates', subtitle: 'Status changes for your consultations' },
    ],
  },
  {
    title: 'Business',
    items: [
      { key: 'earnings' as PrefKey, icon: '💰', title: 'Earnings & Withdrawals', subtitle: 'Payment confirmations and withdrawal updates' },
      { key: 'reviews' as PrefKey, icon: '⭐', title: 'New Patient Reviews', subtitle: 'When a patient rates your consultation' },
    ],
  },
  {
    title: 'Account & More',
    items: [
      { key: 'security' as PrefKey, icon: '🔒', title: 'Account & Security', subtitle: 'Login alerts and security updates' },
      { key: 'announcements' as PrefKey, icon: '📢', title: 'Platform Announcements', subtitle: 'Important updates from Dawa' },
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

export default function DoctorNotificationSettingsPage() {
  const { user } = useUser()
  const { getToken } = useAuth()
  const [userId, setUserId] = useState<string | null>(null)
  const [prefs, setPrefs] = useState<Record<PrefKey, boolean>>(DEFAULTS)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

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
        .select(Object.values(COLUMN).join(', '))
        .eq('user_id', (ud as any).id)
        .maybeSingle()

      if (data) {
        setPrefs(prev => {
          const next = { ...prev }
          ;(Object.keys(COLUMN) as PrefKey[]).forEach(key => {
            const stored = (data as any)[COLUMN[key]]
            if (typeof stored === 'boolean') next[key] = stored
          })
          return next
        })
      }
      setLoading(false)
    }
    load()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user])

  async function savePrefs(next: Record<PrefKey, boolean>) {
    if (!userId) return
    setSaving(true)
    try {
      const token = await getToken()
      if (!token) return
      const client = getAuthClient(token)
      const columns = Object.fromEntries((Object.keys(COLUMN) as PrefKey[]).map(key => [COLUMN[key], next[key]]))
      await client
        .from('notification_preferences')
        .upsert({ user_id: userId, ...columns }, { onConflict: 'user_id' })
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
    ) as Record<PrefKey, boolean>
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
                <p className="text-xs text-ink-black/40 mt-0.5">Enable or disable all notifications at once</p>
              </div>
            </div>
            <Toggle enabled={allEnabled} onToggle={toggleAll} />
          </div>

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

'use client'

import { useState } from 'react'

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

const SECTIONS = [
  {
    title: 'Consultations',
    items: [
      { key: 'new_requests', icon: '🩺', title: 'New Consultation Requests', subtitle: 'Get notified when a patient books with you', enabled: true },
      { key: 'patient_messages', icon: '💬', title: 'Patient Messages', subtitle: 'New messages during active consultations', enabled: true },
      { key: 'consultation_updates', icon: '🔔', title: 'Consultation Updates', subtitle: 'Status changes for your consultations', enabled: true },
    ],
  },
  {
    title: 'Business',
    items: [
      { key: 'earnings', icon: '💰', title: 'Earnings & Withdrawals', subtitle: 'Payment confirmations and withdrawal updates', enabled: true },
      { key: 'reviews', icon: '⭐', title: 'New Patient Reviews', subtitle: 'When a patient rates your consultation', enabled: true },
    ],
  },
  {
    title: 'Account & More',
    items: [
      { key: 'security', icon: '🔒', title: 'Account & Security', subtitle: 'Login alerts and security updates', enabled: true },
      { key: 'announcements', icon: '📢', title: 'Platform Announcements', subtitle: 'Important updates from Dawa', enabled: false },
    ],
  },
]

export default function DoctorNotificationSettingsPage() {
  const [allEnabled, setAllEnabled] = useState(true)
  const [settings, setSettings] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {}
    SECTIONS.forEach(s => s.items.forEach(i => { initial[i.key] = i.enabled }))
    return initial
  })

  function toggleAll() {
    const next = !allEnabled
    setAllEnabled(next)
    setSettings(prev => Object.fromEntries(Object.keys(prev).map(k => [k, next])))
  }

  function toggleOne(key: string) {
    setSettings(prev => ({ ...prev, [key]: !prev[key] }))
  }

  return (
    <div className="p-8 max-w-2xl">
      <div className="mb-8">
        <h1 className="font-montserrat font-black text-3xl text-ink-black">Notifications</h1>
        <p className="text-ink-black/50 text-sm mt-1">Control which notifications you receive</p>
      </div>

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
                  <Toggle enabled={settings[item.key] ?? false} onToggle={() => toggleOne(item.key)} />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <p className="text-xs text-ink-black/30 text-center mt-6">
        Notification preferences are saved locally. Push notification delivery depends on your device settings.
      </p>
    </div>
  )
}

'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

const ALL_COUNTRIES = [
  { code: 'ET', name: 'Ethiopia' },
  { code: 'RW', name: 'Rwanda' },
  { code: 'US', name: 'United States' },
  { code: 'AF', name: 'Afghanistan' },
]

const ALL_LANGUAGES = [
  { code: 'en', name: 'English' },
  { code: 'am', name: 'አማርኛ (Amharic)' },
  { code: 'om', name: 'Afaan Oromoo' },
  { code: 'ti', name: 'ትግርኛ (Tigrinya)' },
  { code: 'fr', name: 'Français' },
  { code: 'ar', name: 'العربية' },
]

const DEFAULT_APPROVAL = `Hello Dr. {name},\n\nWe are pleased to inform you that your Dawa application has been approved!\n\nYou can now log in and start accepting patient consultations.\n\nWelcome to the Dawa team!\n\nBest regards,\nThe Dawa Team`
const DEFAULT_REJECTION = `Hello Dr. {name},\n\nThank you for applying to Dawa. After reviewing your application, we were unable to approve it at this time.\n\nReason: {reason}\n\nIf you believe this is an error or would like to reapply with updated documents, please contact our support team.\n\nBest regards,\nThe Dawa Team`

export default function AdminSettingsPage() {
  const [enabledCountries, setEnabledCountries] = useState<string[]>(['ET', 'RW', 'US', 'AF'])
  const [enabledLanguages, setEnabledLanguages] = useState<string[]>(['en', 'am', 'om', 'ti'])
  const [approvalTemplate, setApprovalTemplate] = useState(DEFAULT_APPROVAL)
  const [rejectionTemplate, setRejectionTemplate] = useState(DEFAULT_REJECTION)
  const [appVersion, setAppVersion] = useState('1.0.0')
  const [versionNotes, setVersionNotes] = useState('Initial release')
  const [androidConfig, setAndroidConfig] = useState({
    min_required_version: '1.0.0',
    latest_version: '1.0.0',
    update_message: 'A new version of Dawa is available. Please update to continue using the app.',
    store_url: 'https://play.google.com/store/apps/details?id=com.carehub',
  })
  const [iosConfig, setIosConfig] = useState({
    min_required_version: '1.0.0',
    latest_version: '1.0.0',
    update_message: 'A new version of Dawa is available. Please update to continue using the app.',
    store_url: 'https://apps.apple.com/app/carehub',
  })
  const [saving, setSaving] = useState<string | null>(null)
  const [savedSections, setSavedSections] = useState<string[]>([])
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    async function loadSettings() {
      const { data, error } = await supabase
        .from('platform_settings')
        .select('key, value')
      if (error || !data) return

      const map: Record<string, unknown> = Object.fromEntries(data.map(r => [r.key, r.value]))

      if (Array.isArray(map.countries)) setEnabledCountries(map.countries as string[])
      if (Array.isArray(map.languages)) setEnabledLanguages(map.languages as string[])
      if (typeof map.email_approval_template === 'string') setApprovalTemplate(map.email_approval_template)
      if (typeof map.email_rejection_template === 'string') setRejectionTemplate(map.email_rejection_template)
      if (typeof map.app_version === 'string') setAppVersion(map.app_version)
      if (typeof map.version_notes === 'string') setVersionNotes(map.version_notes)

      // Load app_config
      const { data: appCfg } = await supabase.from('app_config').select('*')
      if (appCfg) {
        const android = appCfg.find(r => r.platform === 'android')
        const ios = appCfg.find(r => r.platform === 'ios')
        if (android) setAndroidConfig({
          min_required_version: android.min_required_version,
          latest_version: android.latest_version,
          update_message: android.update_message,
          store_url: android.store_url,
        })
        if (ios) setIosConfig({
          min_required_version: ios.min_required_version,
          latest_version: ios.latest_version,
          update_message: ios.update_message,
          store_url: ios.store_url,
        })
      }

      setLoaded(true)
    }
    loadSettings()
  }, [])

  function markSaved(section: string) {
    setSavedSections(prev => [...prev, section])
    setTimeout(() => setSavedSections(prev => prev.filter(s => s !== section)), 3000)
  }

  async function save(section: string, updates: { key: string; value: unknown }[]) {
    setSaving(section)
    const now = new Date().toISOString()
    const { error } = await supabase
      .from('platform_settings')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .upsert(updates.map(u => ({ key: u.key, value: u.value as any, updated_at: now })))
    if (error) {
      alert(`Failed to save: ${error.message}`)
      setSaving(null)
      return
    }
    setSaving(null)
    markSaved(section)
  }

  function toggleCountry(code: string) {
    setEnabledCountries(prev =>
      prev.includes(code) ? prev.filter(c => c !== code) : [...prev, code]
    )
  }

  function toggleLanguage(code: string) {
    setEnabledLanguages(prev =>
      prev.includes(code) ? prev.filter(l => l !== code) : [...prev, code]
    )
  }

  if (!loaded) {
    return (
      <div className="p-8 flex items-center justify-center h-64">
        <div className="text-ink-black/40 text-sm">Loading settings…</div>
      </div>
    )
  }

  return (
    <div className="p-8 max-w-4xl">
      <div className="mb-8">
        <h1 className="font-montserrat font-black text-3xl text-ink-black">Settings</h1>
        <p className="text-ink-black/50 text-sm mt-1">Platform configuration and admin management</p>
      </div>

      <div className="flex flex-col gap-6">
        {/* Countries */}
        <div className="card p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="font-montserrat font-bold text-lg text-ink-black">Supported Countries</h2>
              <p className="text-ink-black/50 text-sm">Toggle which countries can access Dawa</p>
            </div>
            <button
              onClick={() => save('countries', [{ key: 'countries', value: enabledCountries }])}
              className="btn-primary h-9 px-4 text-sm rounded-xl"
              disabled={saving === 'countries'}
            >
              {saving === 'countries' ? 'Saving…' : savedSections.includes('countries') ? '✅ Saved' : 'Save'}
            </button>
          </div>
          <div className="flex flex-col gap-2">
            {ALL_COUNTRIES.map(c => (
              <label key={c.code} className="flex items-center justify-between p-3 rounded-xl hover:bg-cloud-grey cursor-pointer">
                <span className="font-montserrat text-sm font-medium text-ink-black">{c.name}</span>
                <div
                  onClick={() => toggleCountry(c.code)}
                  className={`relative w-11 h-6 rounded-full transition-colors cursor-pointer ${enabledCountries.includes(c.code) ? 'bg-teal-green' : 'bg-steel-grey'}`}
                >
                  <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${enabledCountries.includes(c.code) ? 'translate-x-5' : 'translate-x-0.5'}`} />
                </div>
              </label>
            ))}
          </div>
        </div>

        {/* Languages */}
        <div className="card p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="font-montserrat font-bold text-lg text-ink-black">Supported Languages</h2>
              <p className="text-ink-black/50 text-sm">Toggle which languages are available in the app</p>
            </div>
            <button
              onClick={() => save('languages', [{ key: 'languages', value: enabledLanguages }])}
              className="btn-primary h-9 px-4 text-sm rounded-xl"
              disabled={saving === 'languages'}
            >
              {saving === 'languages' ? 'Saving…' : savedSections.includes('languages') ? '✅ Saved' : 'Save'}
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {ALL_LANGUAGES.map(l => (
              <label key={l.code} className="flex items-center justify-between p-3 rounded-xl hover:bg-cloud-grey cursor-pointer">
                <span className="font-montserrat text-sm font-medium text-ink-black">{l.name}</span>
                <div
                  onClick={() => toggleLanguage(l.code)}
                  className={`relative w-11 h-6 rounded-full transition-colors cursor-pointer ${enabledLanguages.includes(l.code) ? 'bg-teal-green' : 'bg-steel-grey'}`}
                >
                  <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${enabledLanguages.includes(l.code) ? 'translate-x-5' : 'translate-x-0.5'}`} />
                </div>
              </label>
            ))}
          </div>
        </div>

        {/* Email templates */}
        <div className="card p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="font-montserrat font-bold text-lg text-ink-black">Email Templates</h2>
              <p className="text-ink-black/50 text-sm">Use {'{name}'} and {'{reason}'} as placeholders</p>
            </div>
            <button
              onClick={() => save('emails', [
                { key: 'email_approval_template', value: approvalTemplate },
                { key: 'email_rejection_template', value: rejectionTemplate },
              ])}
              className="btn-primary h-9 px-4 text-sm rounded-xl"
              disabled={saving === 'emails'}
            >
              {saving === 'emails' ? 'Saving…' : savedSections.includes('emails') ? '✅ Saved' : 'Save'}
            </button>
          </div>

          <div className="mb-4">
            <p className="text-xs font-bold text-ink-black/50 uppercase tracking-wider mb-2">Approval Email</p>
            <textarea
              rows={6}
              value={approvalTemplate}
              onChange={e => setApprovalTemplate(e.target.value)}
              className="w-full rounded-2xl border border-steel-grey bg-cloud-grey px-4 py-3 text-sm text-ink-black font-montserrat focus:outline-none focus:border-int-blue resize-none"
            />
          </div>

          <div>
            <p className="text-xs font-bold text-ink-black/50 uppercase tracking-wider mb-2">Rejection Email</p>
            <textarea
              rows={6}
              value={rejectionTemplate}
              onChange={e => setRejectionTemplate(e.target.value)}
              className="w-full rounded-2xl border border-steel-grey bg-cloud-grey px-4 py-3 text-sm text-ink-black font-montserrat focus:outline-none focus:border-int-blue resize-none"
            />
          </div>
        </div>

        {/* App Version Control */}
        {(['android', 'ios'] as const).map(platform => {
          const cfg = platform === 'android' ? androidConfig : iosConfig
          const setCfg = platform === 'android' ? setAndroidConfig : setIosConfig
          const sectionKey = `appconfig_${platform}`
          return (
            <div key={platform} className="card p-6">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="font-montserrat font-bold text-lg text-ink-black capitalize">
                    {platform === 'android' ? '🤖 Android' : '🍎 iOS'} App Version
                  </h2>
                  <p className="text-ink-black/50 text-sm">Controls force-update prompts in the mobile app</p>
                </div>
                <button
                  onClick={async () => {
                    setSaving(sectionKey)
                    const res = await fetch('/api/admin/app-config', {
                      method: 'PATCH',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ platform, ...cfg }),
                    })
                    setSaving(null)
                    if (res.ok) markSaved(sectionKey)
                    else alert('Failed to save app config')
                  }}
                  className="btn-primary h-9 px-4 text-sm rounded-xl"
                  disabled={saving === sectionKey}
                >
                  {saving === sectionKey ? 'Saving…' : savedSections.includes(sectionKey) ? '✅ Saved' : 'Save'}
                </button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <p className="text-xs font-bold text-ink-black/50 uppercase tracking-wider mb-2">
                    Minimum Required Version
                    <span className="ml-1 text-[10px] font-normal normal-case text-ink-black/30">(below this = force update)</span>
                  </p>
                  <input
                    value={cfg.min_required_version}
                    onChange={e => setCfg(prev => ({ ...prev, min_required_version: e.target.value }))}
                    placeholder="1.0.0"
                    className="w-full h-10 rounded-xl border border-steel-grey bg-cloud-grey px-3 text-sm font-montserrat text-ink-black focus:outline-none focus:border-int-blue"
                  />
                </div>
                <div>
                  <p className="text-xs font-bold text-ink-black/50 uppercase tracking-wider mb-2">Latest Version</p>
                  <input
                    value={cfg.latest_version}
                    onChange={e => setCfg(prev => ({ ...prev, latest_version: e.target.value }))}
                    placeholder="1.0.0"
                    className="w-full h-10 rounded-xl border border-steel-grey bg-cloud-grey px-3 text-sm font-montserrat text-ink-black focus:outline-none focus:border-int-blue"
                  />
                </div>
                <div className="sm:col-span-2">
                  <p className="text-xs font-bold text-ink-black/50 uppercase tracking-wider mb-2">Update Message</p>
                  <input
                    value={cfg.update_message}
                    onChange={e => setCfg(prev => ({ ...prev, update_message: e.target.value }))}
                    className="w-full h-10 rounded-xl border border-steel-grey bg-cloud-grey px-3 text-sm font-montserrat text-ink-black focus:outline-none focus:border-int-blue"
                  />
                </div>
                <div className="sm:col-span-2">
                  <p className="text-xs font-bold text-ink-black/50 uppercase tracking-wider mb-2">Store URL</p>
                  <input
                    value={cfg.store_url}
                    onChange={e => setCfg(prev => ({ ...prev, store_url: e.target.value }))}
                    className="w-full h-10 rounded-xl border border-steel-grey bg-cloud-grey px-3 text-sm font-montserrat text-ink-black focus:outline-none focus:border-int-blue"
                  />
                </div>
              </div>
            </div>
          )
        })}

        {/* Admin accounts */}
        <div className="card p-6">
          <h2 className="font-montserrat font-bold text-lg text-ink-black mb-1">Admin Account Management</h2>
          <p className="text-ink-black/50 text-sm mb-4">Add or remove admin users (managed via Clerk dashboard)</p>
          <div className="bg-cloud-grey rounded-2xl p-4 text-sm text-ink-black/60">
            Admin users are managed in the{' '}
            <span className="font-semibold text-int-blue">Clerk Dashboard</span>.
            Go to Users → filter by role &quot;admin&quot; to add or remove admins.
          </div>
        </div>
      </div>
    </div>
  )
}

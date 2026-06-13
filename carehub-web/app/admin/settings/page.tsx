'use client'

import { useState } from 'react'

const INITIAL_COUNTRIES = [
  { code: 'ET', name: 'Ethiopia', enabled: true },
  { code: 'RW', name: 'Rwanda', enabled: true },
  { code: 'US', name: 'United States', enabled: true },
  { code: 'AF', name: 'Afghanistan', enabled: true },
]

const INITIAL_LANGUAGES = [
  { code: 'en', name: 'English', enabled: true },
  { code: 'am', name: 'አማርኛ (Amharic)', enabled: true },
  { code: 'om', name: 'Afaan Oromoo', enabled: true },
  { code: 'ti', name: 'ትግርኛ (Tigrinya)', enabled: true },
  { code: 'fr', name: 'Français', enabled: false },
  { code: 'ar', name: 'العربية', enabled: false },
]

export default function AdminSettingsPage() {
  const [countries, setCountries] = useState(INITIAL_COUNTRIES)
  const [languages, setLanguages] = useState(INITIAL_LANGUAGES)
  const [approvalTemplate, setApprovalTemplate] = useState(
    `Hello Dr. {name},\n\nWe are pleased to inform you that your CareHub application has been approved!\n\nYou can now log in and start accepting patient consultations.\n\nWelcome to the CareHub team!\n\nBest regards,\nThe CareHub Team`
  )
  const [rejectionTemplate, setRejectionTemplate] = useState(
    `Hello Dr. {name},\n\nThank you for applying to CareHub. After reviewing your application, we were unable to approve it at this time.\n\nReason: {reason}\n\nIf you believe this is an error or would like to reapply with updated documents, please contact our support team.\n\nBest regards,\nThe CareHub Team`
  )
  const [appVersion, setAppVersion] = useState('1.0.0')
  const [versionNotes, setVersionNotes] = useState('Initial release')
  const [saving, setSaving] = useState<string | null>(null)

  function toggleCountry(code: string) {
    setCountries(prev => prev.map(c => c.code === code ? { ...c, enabled: !c.enabled } : c))
  }

  function toggleLanguage(code: string) {
    setLanguages(prev => prev.map(l => l.code === code ? { ...l, enabled: !l.enabled } : l))
  }

  function save(section: string) {
    setSaving(section)
    setTimeout(() => setSaving(null), 1200)
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
              <p className="text-ink-black/50 text-sm">Toggle which countries can access CareHub</p>
            </div>
            <button
              onClick={() => save('countries')}
              className="btn-primary h-9 px-4 text-sm rounded-xl"
              disabled={saving === 'countries'}
            >
              {saving === 'countries' ? '✅ Saved' : 'Save'}
            </button>
          </div>
          <div className="flex flex-col gap-2">
            {countries.map(c => (
              <label key={c.code} className="flex items-center justify-between p-3 rounded-xl hover:bg-cloud-grey cursor-pointer">
                <span className="font-montserrat text-sm font-medium text-ink-black">{c.name}</span>
                <div
                  onClick={() => toggleCountry(c.code)}
                  className={`relative w-11 h-6 rounded-full transition-colors cursor-pointer ${c.enabled ? 'bg-teal-green' : 'bg-steel-grey'}`}
                >
                  <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${c.enabled ? 'translate-x-5' : 'translate-x-0.5'}`} />
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
              onClick={() => save('languages')}
              className="btn-primary h-9 px-4 text-sm rounded-xl"
              disabled={saving === 'languages'}
            >
              {saving === 'languages' ? '✅ Saved' : 'Save'}
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {languages.map(l => (
              <label key={l.code} className="flex items-center justify-between p-3 rounded-xl hover:bg-cloud-grey cursor-pointer">
                <span className="font-montserrat text-sm font-medium text-ink-black">{l.name}</span>
                <div
                  onClick={() => toggleLanguage(l.code)}
                  className={`relative w-11 h-6 rounded-full transition-colors cursor-pointer ${l.enabled ? 'bg-teal-green' : 'bg-steel-grey'}`}
                >
                  <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${l.enabled ? 'translate-x-5' : 'translate-x-0.5'}`} />
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
              onClick={() => save('emails')}
              className="btn-primary h-9 px-4 text-sm rounded-xl"
              disabled={saving === 'emails'}
            >
              {saving === 'emails' ? '✅ Saved' : 'Save'}
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

        {/* App version */}
        <div className="card p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="font-montserrat font-bold text-lg text-ink-black">App Version Notes</h2>
              <p className="text-ink-black/50 text-sm">Displayed in the mobile app update prompt</p>
            </div>
            <button
              onClick={() => save('version')}
              className="btn-primary h-9 px-4 text-sm rounded-xl"
              disabled={saving === 'version'}
            >
              {saving === 'version' ? '✅ Saved' : 'Save'}
            </button>
          </div>
          <div className="flex gap-4">
            <div>
              <p className="text-xs font-bold text-ink-black/50 uppercase tracking-wider mb-2">Version</p>
              <input
                value={appVersion}
                onChange={e => setAppVersion(e.target.value)}
                className="w-28 h-10 rounded-xl border border-steel-grey bg-cloud-grey px-3 text-sm font-montserrat text-ink-black focus:outline-none focus:border-int-blue"
              />
            </div>
            <div className="flex-1">
              <p className="text-xs font-bold text-ink-black/50 uppercase tracking-wider mb-2">Release Notes</p>
              <input
                value={versionNotes}
                onChange={e => setVersionNotes(e.target.value)}
                className="w-full h-10 rounded-xl border border-steel-grey bg-cloud-grey px-3 text-sm font-montserrat text-ink-black focus:outline-none focus:border-int-blue"
              />
            </div>
          </div>
        </div>

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

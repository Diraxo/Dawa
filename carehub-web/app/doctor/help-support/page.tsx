'use client'

import { useState } from 'react'
import Link from 'next/link'

const FAQS = [
  {
    section: 'Getting Started',
    icon: '🚀',
    items: [
      {
        q: 'How do I get approved as a doctor?',
        a: 'After completing your registration (license, specialty, documents, pricing), your application is reviewed by our admin team within 24–48 hours. You\'ll be notified by email and in-app when approved or rejected.',
      },
      {
        q: 'What documents do I need to register?',
        a: 'You need a valid medical license (PDF or image) and optionally a national ID or passport for identity verification.',
      },
      {
        q: 'Can I update my profile after approval?',
        a: 'Yes. You can update your bio, hospital name, pricing, and profile photo anytime from your profile page. Documents require contacting support.',
      },
    ],
  },
  {
    section: 'Consultations',
    icon: '🩺',
    items: [
      {
        q: 'How do consultation requests work?',
        a: 'When a patient books with you, you\'ll receive a push notification. Accept or decline whenever you\'re ready — if there\'s no response for an extended period, the request is automatically declined and the patient\'s payment is preserved as credit.',
      },
      {
        q: 'What happens after a consultation ends?',
        a: 'You fill in consultation notes (chief complaint, diagnosis, optional prescription, follow-up, referral). The patient receives a summary and can rate their experience.',
      },
      {
        q: 'Can I set my own schedule?',
        a: 'Yes. In the Schedule tab, you can set your available hours per day, enable/disable specific days, and toggle between on-demand and scheduled modes.',
      },
    ],
  },
  {
    section: 'Earnings',
    icon: '💰',
    items: [
      {
        q: 'How does the earnings model work?',
        a: 'You keep 80% of every consultation fee. Dawa retains a 20% platform fee to cover operations, payment processing, and tech infrastructure.',
      },
      {
        q: 'How do I set my consultation prices?',
        a: 'You set separate prices for Chat, Phone, and Video consultations during registration. You can change them anytime from your profile → My Pricing.',
      },
      {
        q: 'When can I withdraw my earnings?',
        a: 'Go to the Withdraw page from the sidebar. Enter your bank details and the amount, and our team will process the transfer within 1–3 business days.',
      },
    ],
  },
  {
    section: 'Account & Privacy',
    icon: '🔒',
    items: [
      {
        q: 'Is my patient data protected?',
        a: 'All patient information is encrypted and stored securely. You only see data for your own consultations. We comply with medical data privacy standards.',
      },
      {
        q: 'What if my application is rejected?',
        a: 'You\'ll receive the rejection reason in-app and by email. You can contact support@dawa.app to appeal or clarify your application.',
      },
    ],
  },
]

export default function DoctorHelpSupportPage() {
  const [openItem, setOpenItem] = useState<string | null>(null)
  const [activeSection, setActiveSection] = useState('All')

  const sections = ['All', ...FAQS.map(f => f.section)]
  const filtered = activeSection === 'All' ? FAQS : FAQS.filter(f => f.section === activeSection)

  return (
    <div className="p-8 max-w-3xl">
      <div
        className="rounded-3xl p-8 mb-8 text-center"
        style={{ background: 'linear-gradient(to right, #1A4598, #00BFA5)' }}
      >
        <p className="text-4xl mb-3">💬</p>
        <h1 className="font-montserrat font-black text-3xl text-white mb-2">Doctor Help Center</h1>
        <p className="text-white/70 text-sm">Find answers to common questions about using Dawa as a doctor</p>
      </div>

      <div className="flex flex-wrap gap-2 mb-8">
        {sections.map(s => (
          <button
            key={s}
            onClick={() => setActiveSection(s)}
            className="px-4 py-2 rounded-full font-montserrat font-semibold text-sm transition-all"
            style={activeSection === s
              ? { background: 'linear-gradient(to right, #2962FF, #00BFA5)', color: '#fff' }
              : { background: '#F5F7FA', color: '#6B7280' }
            }
          >
            {s}
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-6 mb-10">
        {filtered.map(section => (
          <div key={section.section}>
            <div className="flex items-center gap-2 mb-3">
              <span className="text-xl">{section.icon}</span>
              <h2 className="font-montserrat font-bold text-base text-ink-black">{section.section}</h2>
            </div>
            <div className="card divide-y divide-cloud-grey overflow-hidden">
              {section.items.map(item => {
                const key = `${section.section}-${item.q}`
                const isOpen = openItem === key
                return (
                  <div key={key}>
                    <button
                      onClick={() => setOpenItem(isOpen ? null : key)}
                      className="w-full flex items-center justify-between gap-4 px-5 py-4 text-left hover:bg-cloud-grey transition-colors"
                    >
                      <p className="font-montserrat font-semibold text-sm text-ink-black">{item.q}</p>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#9CA3AF" strokeWidth="2.5"
                        className={`flex-shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`}>
                        <polyline points="6 9 12 15 18 9"/>
                      </svg>
                    </button>
                    {isOpen && (
                      <div className="px-5 pb-4 bg-cloud-grey/50">
                        <p className="text-sm text-ink-black/70 leading-relaxed">{item.a}</p>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>

      <div className="card p-6 mb-6">
        <h2 className="font-montserrat font-bold text-lg text-ink-black mb-4">Still need help?</h2>
        <div className="flex flex-col gap-3">
          <a href="mailto:support@dawa.app"
            className="flex items-center gap-4 p-4 rounded-2xl bg-cloud-grey hover:bg-[#EFF6FF] transition-colors">
            <div className="w-10 h-10 rounded-xl bg-[#EFF6FF] flex items-center justify-center text-xl flex-shrink-0">✉️</div>
            <div>
              <p className="font-montserrat font-semibold text-sm text-ink-black">Email Support</p>
              <p className="text-xs text-ink-black/40">support@dawa.app · Response within 24h</p>
            </div>
          </a>
        </div>
      </div>

      <div className="card p-5">
        <p className="font-montserrat font-bold text-sm text-ink-black mb-3">Legal</p>
        <div className="flex flex-col gap-2">
          <Link href="/privacy" className="flex items-center justify-between py-2 text-sm text-ink-black/70 hover:text-ink-black">
            Privacy Policy <span className="text-ink-black/30">›</span>
          </Link>
          <div className="h-px bg-cloud-grey" />
          <Link href="/terms" className="flex items-center justify-between py-2 text-sm text-ink-black/70 hover:text-ink-black">
            Terms of Service <span className="text-ink-black/30">›</span>
          </Link>
        </div>
      </div>
    </div>
  )
}

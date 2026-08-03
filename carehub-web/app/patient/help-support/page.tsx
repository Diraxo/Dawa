'use client'

import { useState } from 'react'
import Link from 'next/link'

const FAQS = [
  {
    section: 'Getting Started',
    icon: '🚀',
    items: [
      {
        q: 'How do I create an account?',
        a: 'Tap "Sign Up" on the home screen and enter your email address. You\'ll receive a 6-digit verification code. Enter the code and select "Patient" as your role.',
      },
      {
        q: 'Is Dawa free to use?',
        a: 'Creating an account is free. You pay per consultation based on the doctor\'s rates. All prices are shown before you book.',
      },
      {
        q: 'What devices does Dawa support?',
        a: 'Dawa is available as an Android app and on this website, which works on all devices including iPhone, iPad, and desktop.',
      },
    ],
  },
  {
    section: 'Consultations',
    icon: '🩺',
    items: [
      {
        q: 'What types of consultations are available?',
        a: 'Dawa offers three consultation types: Chat (text-based), Phone Call (audio only), and Video Call. Each doctor sets their own price per type.',
      },
      {
        q: 'How do I start a consultation?',
        a: 'Browse doctors, select one, choose your consultation type, complete booking, and wait in the virtual waiting room until the doctor accepts.',
      },
      {
        q: 'What happens if the doctor doesn\'t respond?',
        a: 'If the doctor doesn\'t respond within a reasonable time, the request is automatically cancelled, your credit is preserved, and you can try another doctor.',
      },
      {
        q: 'Can I schedule consultations in advance?',
        a: 'Yes! During booking, choose "Schedule" and pick a date and time that works for you.',
      },
    ],
  },
  {
    section: 'Doctors & Verification',
    icon: '✅',
    items: [
      {
        q: 'Are all doctors verified?',
        a: 'Yes. Every doctor on Dawa is verified by our admin team before they can accept consultations. They submit their medical license and ID during registration.',
      },
      {
        q: 'How are doctors rated?',
        a: 'After each consultation, you can rate your doctor 1–5 stars and leave a comment. Ratings are publicly visible on their profile.',
      },
      {
        q: 'Can I choose a specific doctor?',
        a: 'Yes, you can browse all available doctors, filter by specialty, and view their full profile including experience, bio, pricing, and patient reviews.',
      },
    ],
  },
  {
    section: 'Account & Privacy',
    icon: '🔒',
    items: [
      {
        q: 'How is my health data protected?',
        a: 'Your data is stored securely using industry-standard encryption. We never share your personal health information with third parties.',
      },
      {
        q: 'Can I delete my account?',
        a: 'Yes. Contact us at support@dawa.app to request account deletion. All your data will be permanently removed within 30 days.',
      },
      {
        q: 'How do I reset my password?',
        a: 'On the sign-in page, tap "Forgot password?" and enter your email. You\'ll receive a verification code to set a new password.',
      },
    ],
  },
]

export default function PatientHelpSupportPage() {
  const [openItem, setOpenItem] = useState<string | null>(null)
  const [activeSection, setActiveSection] = useState('All')

  const sections = ['All', ...FAQS.map(f => f.section)]
  const filtered = activeSection === 'All' ? FAQS : FAQS.filter(f => f.section === activeSection)

  return (
    <div className="p-8 max-w-3xl">
      {/* Header */}
      <div
        className="rounded-3xl p-8 mb-8 text-center"
        style={{ background: 'linear-gradient(to right, #1A4598, #00BFA5)' }}
      >
        <p className="text-4xl mb-3">💬</p>
        <h1 className="font-montserrat font-black text-3xl text-white mb-2">How can we help?</h1>
        <p className="text-white/70 text-sm">Find answers to common questions below</p>
      </div>

      {/* Section filter */}
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

      {/* FAQ sections */}
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
                      <svg
                        width="16" height="16" viewBox="0 0 24 24" fill="none"
                        stroke="#9CA3AF" strokeWidth="2.5"
                        className={`flex-shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`}
                      >
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

      {/* Contact */}
      <div className="card p-6 mb-6">
        <h2 className="font-montserrat font-bold text-lg text-ink-black mb-4">Still need help?</h2>
        <div className="flex flex-col gap-3">
          <a
            href="mailto:support@dawa.app"
            className="flex items-center gap-4 p-4 rounded-2xl bg-cloud-grey hover:bg-[#EFF6FF] transition-colors"
          >
            <div className="w-10 h-10 rounded-xl bg-[#EFF6FF] flex items-center justify-center text-xl flex-shrink-0">✉️</div>
            <div>
              <p className="font-montserrat font-semibold text-sm text-ink-black">Email Support</p>
              <p className="text-xs text-ink-black/40">support@dawa.app · Response within 24h</p>
            </div>
          </a>
          <div className="flex items-center gap-4 p-4 rounded-2xl bg-cloud-grey opacity-50 cursor-not-allowed">
            <div className="w-10 h-10 rounded-xl bg-cloud-grey flex items-center justify-center text-xl flex-shrink-0">💬</div>
            <div>
              <p className="font-montserrat font-semibold text-sm text-ink-black">WhatsApp Support</p>
              <p className="text-xs text-ink-black/40">Coming soon</p>
            </div>
          </div>
        </div>
      </div>

      {/* Legal */}
      <div className="card p-5">
        <p className="font-montserrat font-bold text-sm text-ink-black mb-3">Legal</p>
        <div className="flex flex-col gap-2">
          <Link href="/privacy" className="flex items-center justify-between py-2 text-sm text-ink-black/70 hover:text-ink-black transition-colors">
            Privacy Policy <span className="text-ink-black/30">›</span>
          </Link>
          <div className="h-px bg-cloud-grey" />
          <Link href="/terms" className="flex items-center justify-between py-2 text-sm text-ink-black/70 hover:text-ink-black transition-colors">
            Terms of Service <span className="text-ink-black/30">›</span>
          </Link>
        </div>
      </div>
    </div>
  )
}

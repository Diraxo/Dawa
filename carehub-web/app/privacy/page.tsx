import type { Metadata } from 'next'
import Footer from '@/components/landing/Footer'
import Navbar from '@/components/landing/Navbar'

export const metadata: Metadata = {
  title: 'Privacy Policy — Dawa',
  description:
    'Learn how Dawa collects, uses, and protects your personal information and health data.',
}

const LAST_UPDATED = 'June 2026'

type Block =
  | { type: 'text'; text: string }
  | { type: 'bullets'; items: string[] }
  | { type: 'subsection'; label: string; items: string[] }

interface Section {
  num: string
  title: string
  blocks: Block[]
}

const SECTIONS: Section[] = [
  {
    num: '1',
    title: 'INTRODUCTION',
    blocks: [
      {
        type: 'text',
        text: 'Dawa ("we", "our", "us") is committed to protecting your personal information and health data. This Privacy Policy explains how we collect, use, store, and protect your information when you use the Dawa mobile application and website.',
      },
    ],
  },
  {
    num: '2',
    title: 'INFORMATION WE COLLECT',
    blocks: [
      {
        type: 'subsection',
        label: 'Personal Information:',
        items: ['Full name, email address, phone number', 'Date of birth, gender', 'Profile photo'],
      },
      {
        type: 'subsection',
        label: 'Health Information:',
        items: [
          'Symptoms and health concerns you describe during consultations',
          'Consultation summaries, diagnoses, and prescriptions',
          'Medical records you choose to upload',
        ],
      },
      {
        type: 'subsection',
        label: 'Doctor Information (Healthcare Professionals only):',
        items: [
          'Medical license number and documents',
          'National ID or passport',
          'Specialty, hospital affiliation, years of experience',
        ],
      },
      {
        type: 'subsection',
        label: 'Technical Information:',
        items: [
          'Device type and operating system',
          'App usage data and crash reports',
          'IP address and approximate location (country level only)',
        ],
      },
    ],
  },
  {
    num: '3',
    title: 'HOW WE USE YOUR INFORMATION',
    blocks: [
      { type: 'text', text: 'We use your information to:' },
      {
        type: 'bullets',
        items: [
          'Connect you with verified healthcare professionals',
          'Facilitate chat, phone, and video consultations',
          'Send appointment reminders and consultation summaries',
          'Verify doctor credentials before approval',
          'Improve our services and user experience',
          'Comply with applicable laws and regulations',
        ],
      },
    ],
  },
  {
    num: '4',
    title: 'HOW WE PROTECT YOUR INFORMATION',
    blocks: [
      {
        type: 'bullets',
        items: [
          'All data is encrypted in transit using TLS 1.3',
          'All data is encrypted at rest using AES-256',
          'Health data is stored on secure Supabase servers',
          'Doctor documents are stored in encrypted file storage',
          'We never sell your personal or health data to third parties',
          'Access to your data is restricted to authorized Dawa staff only',
          'Consultation chats are private between patient and doctor only',
        ],
      },
    ],
  },
  {
    num: '5',
    title: 'DATA SHARING',
    blocks: [
      { type: 'text', text: 'We do NOT sell your data. We only share data with:' },
      {
        type: 'bullets',
        items: [
          'The doctor you consult with (only during your consultation)',
          'Supabase (our secure database provider)',
          'Clerk (our authentication provider)',
          'Agora (video/audio call infrastructure only — no health data shared)',
          'Stream (chat infrastructure only — messages are encrypted)',
          'Firebase (push notifications only — no health data shared)',
          'Law enforcement when required by law',
        ],
      },
    ],
  },
  {
    num: '6',
    title: 'YOUR RIGHTS',
    blocks: [
      { type: 'text', text: 'You have the right to:' },
      {
        type: 'bullets',
        items: [
          'Access your personal data at any time',
          'Correct inaccurate information',
          'Delete your account and all associated data',
          'Download your consultation history',
          'Opt out of non-essential communications',
        ],
      },
      { type: 'text', text: 'To exercise these rights, contact us at: privacy@dawa.app' },
    ],
  },
  {
    num: '7',
    title: 'DATA RETENTION',
    blocks: [
      {
        type: 'bullets',
        items: [
          'Active account data: retained while your account is active',
          'Consultation records: retained for 5 years for medical compliance',
          'Deleted accounts: all personal data deleted within 30 days',
          'Doctor documents: deleted immediately if application is rejected',
        ],
      },
    ],
  },
  {
    num: '8',
    title: "CHILDREN'S PRIVACY",
    blocks: [
      {
        type: 'text',
        text: 'Dawa is not intended for children under 18 without parental consent. We do not knowingly collect data from children under 13.',
      },
    ],
  },
  {
    num: '9',
    title: 'COOKIES AND TRACKING (Website only)',
    blocks: [
      {
        type: 'text',
        text: 'Our website uses only essential cookies for authentication and session management. We do not use advertising cookies or tracking pixels.',
      },
    ],
  },
  {
    num: '10',
    title: 'CHANGES TO THIS POLICY',
    blocks: [
      {
        type: 'text',
        text: 'We will notify you of significant changes via email and in-app notification at least 30 days before changes take effect.',
      },
    ],
  },
  {
    num: '11',
    title: 'CONTACT US',
    blocks: [
      {
        type: 'text',
        text: 'Dawa Support Team\nEmail: privacy@dawa.app\nWebsite: www.dawa.app/privacy',
      },
    ],
  },
]

function renderBlock(block: Block, idx: number) {
  if (block.type === 'text') {
    return (
      <p key={idx} className="text-[14px] text-ink-black leading-[1.8] mb-3 whitespace-pre-line">
        {block.text}
      </p>
    )
  }
  if (block.type === 'bullets') {
    return (
      <ul key={idx} className="mb-3 space-y-2">
        {block.items.map((item, i) => (
          <li key={i} className="flex items-start gap-2.5">
            <span className="text-teal-green mt-[3px] text-base leading-none select-none">•</span>
            <span className="text-[14px] text-ink-black leading-[1.8]">{item}</span>
          </li>
        ))}
      </ul>
    )
  }
  if (block.type === 'subsection') {
    return (
      <div key={idx} className="mb-5">
        <p className="font-semibold text-[14px] text-ink-black mb-2">{block.label}</p>
        <ul className="space-y-2 pl-1">
          {block.items.map((item, i) => (
            <li key={i} className="flex items-start gap-2.5">
              <span className="text-teal-green mt-[3px] text-base leading-none select-none">•</span>
              <span className="text-[14px] text-ink-black leading-[1.8]">{item}</span>
            </li>
          ))}
        </ul>
      </div>
    )
  }
  return null
}

export default function PrivacyPage() {
  return (
    <>
      <Navbar />

      <main className="bg-white min-h-screen pt-24 pb-20">
        <div className="max-w-[800px] mx-auto px-6">

          {/* Page header */}
          <div className="mb-10 pt-6">
            <h1 className="font-bold text-[32px] text-ink-black leading-tight mb-2">
              Privacy Policy
            </h1>
            <p className="text-[12px] text-gray-400 font-montserrat">
              Last updated: {LAST_UPDATED}
            </p>
          </div>

          {/* Sections */}
          {SECTIONS.map((sec, idx) => (
            <div key={sec.num}>
              {idx > 0 && <hr className="border-steel-grey" />}
              <div className="py-7">
                <h3 className="font-semibold text-[20px] text-teal-green leading-snug mb-4">
                  {sec.num}. {sec.title}
                </h3>
                {sec.blocks.map((block, bidx) => renderBlock(block, bidx))}
              </div>
            </div>
          ))}

          {/* Footer contact card */}
          <hr className="border-steel-grey" />
          <div className="mt-8 mb-4">
            <a
              href="mailto:privacy@dawa.app"
              className="inline-flex items-center gap-3 bg-teal-green/5 border border-teal-green/20 rounded-xl px-5 py-4 hover:bg-teal-green/10 transition-colors group"
            >
              <svg
                className="w-5 h-5 text-teal-green flex-shrink-0"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.8}
                  d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                />
              </svg>
              <span className="text-[14px] text-ink-black">
                Contact us:{' '}
                <span className="font-semibold text-teal-green group-hover:underline">
                  privacy@dawa.app
                </span>
              </span>
            </a>
          </div>

        </div>
      </main>

      <Footer />
    </>
  )
}

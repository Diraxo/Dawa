import type { Metadata } from 'next'
import Footer from '@/components/landing/Footer'
import Navbar from '@/components/landing/Navbar'

export const metadata: Metadata = {
  title: 'Terms of Service — CareHub',
  description:
    'Read the CareHub Terms of Service to understand the rules and guidelines for using our telemedicine platform.',
}

const LAST_UPDATED = 'June 2025'

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
    title: 'ACCEPTANCE OF TERMS',
    blocks: [
      {
        type: 'text',
        text: 'By using CareHub, you agree to these Terms of Service. If you do not agree, please do not use our services.',
      },
    ],
  },
  {
    num: '2',
    title: 'DESCRIPTION OF SERVICE',
    blocks: [
      {
        type: 'text',
        text: 'CareHub is a telemedicine platform that connects patients with verified healthcare professionals for remote consultations via chat, phone call, and video call.',
      },
      {
        type: 'text',
        text: 'CareHub does NOT provide emergency medical services. If you have a medical emergency, call your local emergency number immediately.',
      },
    ],
  },
  {
    num: '3',
    title: 'MEDICAL DISCLAIMER',
    blocks: [
      {
        type: 'text',
        text: 'IMPORTANT: CareHub consultations are not a substitute for in-person emergency care. Doctors on CareHub provide general medical advice and consultations only. For any life-threatening condition, go to your nearest hospital or call emergency services immediately.',
      },
    ],
  },
  {
    num: '4',
    title: 'USER ACCOUNTS',
    blocks: [
      {
        type: 'subsection',
        label: 'Patients:',
        items: [
          'You must provide accurate personal information',
          'You are responsible for keeping your account secure',
          'You must be 18 or older, or have parental consent',
          'One account per person',
        ],
      },
      {
        type: 'subsection',
        label: 'Healthcare Professionals:',
        items: [
          'You must hold a valid medical license in your country',
          'You must provide authentic documents during registration',
          'Providing false credentials will result in permanent ban and may be reported to medical authorities',
          'You are responsible for the medical advice you provide',
          'You must maintain your own professional liability insurance',
        ],
      },
    ],
  },
  {
    num: '5',
    title: 'CONSULTATION RULES',
    blocks: [
      {
        type: 'subsection',
        label: 'For Patients:',
        items: [
          'Be respectful to healthcare professionals',
          'Provide accurate health information',
          'Do not misuse the platform for non-medical purposes',
          'Payments are processed before consultations begin',
        ],
      },
      {
        type: 'subsection',
        label: 'For Doctors:',
        items: [
          'You must respond to consultation requests within 30 seconds',
          'You must provide professional, ethical medical advice',
          'You must complete consultation notes after each session',
          'You cannot solicit patients outside the platform',
        ],
      },
    ],
  },
  {
    num: '6',
    title: 'PAYMENTS AND REFUNDS',
    blocks: [
      {
        type: 'bullets',
        items: [
          'Consultation fees are charged per session',
          'CareHub takes a 20% platform commission',
          'Doctors receive 80% of each consultation fee',
          'Refunds are available if a doctor does not respond within 30 seconds of a request',
          'Refunds are NOT available once a consultation has started',
          'Withdrawal requests are processed within 3-5 business days',
        ],
      },
    ],
  },
  {
    num: '7',
    title: 'PROHIBITED USES',
    blocks: [
      { type: 'text', text: 'You may NOT use CareHub to:' },
      {
        type: 'bullets',
        items: [
          'Provide or receive emergency medical care',
          'Share false or misleading health information',
          'Harass or abuse other users',
          'Attempt to contact doctors outside the platform',
          'Upload illegal or inappropriate content',
          'Violate any applicable laws or regulations',
        ],
      },
    ],
  },
  {
    num: '8',
    title: 'INTELLECTUAL PROPERTY',
    blocks: [
      {
        type: 'text',
        text: 'All CareHub content, logo, design, and software are owned by CareHub and protected by copyright law. You may not copy, modify, or distribute our content without permission.',
      },
    ],
  },
  {
    num: '9',
    title: 'LIMITATION OF LIABILITY',
    blocks: [
      {
        type: 'text',
        text: 'CareHub is a platform connecting patients and doctors. We are not liable for the medical advice provided by doctors on our platform. Doctors are independent healthcare professionals, not CareHub employees.',
      },
    ],
  },
  {
    num: '10',
    title: 'TERMINATION',
    blocks: [
      {
        type: 'text',
        text: 'We reserve the right to suspend or terminate accounts that violate these terms, without prior notice.',
      },
    ],
  },
  {
    num: '11',
    title: 'GOVERNING LAW',
    blocks: [
      {
        type: 'text',
        text: 'These terms are governed by the laws of Ethiopia. Disputes will be resolved in Ethiopian courts.',
      },
    ],
  },
  {
    num: '12',
    title: 'CONTACT',
    blocks: [
      {
        type: 'text',
        text: 'For questions about these terms:\nEmail: legal@carehub.com\nWebsite: www.carehub.com/terms',
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

export default function TermsPage() {
  return (
    <>
      <Navbar />

      <main className="bg-white min-h-screen pt-24 pb-20">
        <div className="max-w-[800px] mx-auto px-6">

          {/* Page header */}
          <div className="mb-10 pt-6">
            <h1 className="font-bold text-[32px] text-ink-black leading-tight mb-2">
              Terms of Service
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
              href="mailto:legal@carehub.com"
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
                  legal@carehub.com
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

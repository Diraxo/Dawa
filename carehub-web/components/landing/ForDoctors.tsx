'use client'

import { motion, useInView } from 'framer-motion'
import { useRef } from 'react'
import Link from 'next/link'

const benefits = [
  {
    icon: '💰',
    title: 'Earn on Your Schedule',
    desc: 'Set your own rates for chat, phone, and video consultations. Work as much or as little as you want.',
  },
  {
    icon: '🌐',
    title: 'Reach More Patients',
    desc: 'Grow your practice beyond geographic limits. Reach patients across multiple countries through one platform.',
  },
  {
    icon: '📊',
    title: 'Full Analytics Dashboard',
    desc: 'Track consultations, earnings, ratings, and patient history — all from your personalized dashboard.',
  },
  {
    icon: '🔒',
    title: 'Secure & Compliant',
    desc: 'All consultations are encrypted end-to-end. Patient data is protected to the highest security standards.',
  },
]

const steps = [
  { label: 'Apply', desc: 'Submit your credentials' },
  { label: 'Review', desc: 'Admin verifies in 24–48h' },
  { label: 'Approved', desc: 'Go online and start earning' },
]

export default function ForDoctors() {
  const ref = useRef(null)
  const inView = useInView(ref, { once: true, margin: '-80px' })

  return (
    <section id="for-doctors" className="section-padding bg-white" ref={ref}>
      <div className="container-site">
        <div className="grid lg:grid-cols-2 gap-16 items-center">
          {/* Left */}
          <div>
            <motion.div
              initial={{ opacity: 0, x: -40 }}
              animate={inView ? { opacity: 1, x: 0 } : {}}
              transition={{ duration: 0.7 }}
            >
              <span className="inline-block px-4 py-1.5 rounded-full bg-care-blue/8 text-care-blue text-xs font-bold uppercase tracking-widest mb-4">
                For Healthcare Professionals
              </span>
              <h2 className="font-montserrat font-black text-4xl md:text-5xl text-ink-black leading-[1.1] mb-6">
                Grow Your Practice.{' '}
                <span className="gradient-hero-text">Your Way.</span>
              </h2>
              <p className="text-ink-black/60 text-lg leading-relaxed mb-8">
                Join hundreds of doctors already using CareHub to deliver exceptional care — without the overhead of a traditional clinic.
              </p>

              {/* Process steps */}
              <div className="flex items-center gap-3 mb-10">
                {steps.map((s, i) => (
                  <div key={s.label} className="flex items-center gap-3">
                    <div className="text-center">
                      <div className="w-9 h-9 rounded-full bg-gradient-interactive flex items-center justify-center text-white font-black text-sm mb-1 mx-auto shadow-blue">
                        {i + 1}
                      </div>
                      <p className="text-ink-black font-bold text-xs">{s.label}</p>
                      <p className="text-ink-black/50 text-[10px]">{s.desc}</p>
                    </div>
                    {i < steps.length - 1 && (
                      <div className="flex-1 h-0.5 bg-gradient-to-r from-int-blue to-teal-green rounded-full" />
                    )}
                  </div>
                ))}
              </div>

              <Link href="/sign-up" className="btn-primary">
                Apply as a Doctor →
              </Link>
            </motion.div>
          </div>

          {/* Right: benefit cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {benefits.map((b, i) => (
              <motion.div
                key={b.title}
                initial={{ opacity: 0, y: 32 }}
                animate={inView ? { opacity: 1, y: 0 } : {}}
                transition={{ duration: 0.55, delay: 0.15 + i * 0.12 }}
                className="card card-hover p-6 flex flex-col gap-3"
              >
                <div className="w-11 h-11 rounded-2xl bg-cloud-grey flex items-center justify-center text-2xl">
                  {b.icon}
                </div>
                <h3 className="font-montserrat font-bold text-base text-ink-black">{b.title}</h3>
                <p className="text-ink-black/60 text-sm leading-relaxed">{b.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}

'use client'

import { motion, useInView } from 'framer-motion'
import { useRef } from 'react'

const steps = [
  {
    num: '01',
    icon: '🔍',
    title: 'Find Your Doctor',
    description: 'Browse hundreds of verified, board-certified doctors by specialty, rating, availability, and consultation fee.',
    color: 'from-care-blue to-int-blue',
    shadow: 'shadow-blue',
  },
  {
    num: '02',
    icon: '📅',
    title: 'Book a Consultation',
    description: 'Choose chat, phone, or video. Pick a time that works for you — or connect instantly with an available doctor.',
    color: 'from-int-blue to-teal-green',
    shadow: 'shadow-teal',
  },
  {
    num: '03',
    icon: '🩺',
    title: 'Get Expert Care',
    description: 'Consult your doctor in real time. Receive your diagnosis, prescription, and follow-up plan — all in one place.',
    color: 'from-teal-green to-emerald-400',
    shadow: 'shadow-teal',
  },
]

export default function HowItWorks() {
  const ref = useRef(null)
  const inView = useInView(ref, { once: true, margin: '-80px' })

  return (
    <section id="how-it-works" className="section-padding bg-cloud-grey" ref={ref}>
      <div className="container-site">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 32 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.7 }}
          className="text-center mb-16"
        >
          <span className="inline-block px-4 py-1.5 rounded-full bg-teal-green/10 text-teal-green text-xs font-bold uppercase tracking-widest mb-4">
            How It Works
          </span>
          <h2 className="font-montserrat font-black text-4xl md:text-5xl text-ink-black mb-4">
            Healthcare in{' '}
            <span className="gradient-hero-text">3 Simple Steps</span>
          </h2>
          <p className="text-ink-black/60 text-lg max-w-[520px] mx-auto leading-relaxed">
            From signup to consultation in under 5 minutes. It&apos;s that easy.
          </p>
        </motion.div>

        {/* Steps */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 relative">
          {/* Connector lines (desktop) */}
          <div className="hidden md:block absolute top-[72px] left-[33%] right-[33%] h-0.5"
            style={{ background: 'linear-gradient(to right, #1A4598, #00BFA5)' }} />

          {steps.map((step, i) => (
            <motion.div
              key={step.num}
              initial={{ opacity: 0, y: 40 }}
              animate={inView ? { opacity: 1, y: 0 } : {}}
              transition={{ duration: 0.6, delay: 0.2 + i * 0.18 }}
              className="relative"
            >
              <div className="card card-hover p-8 h-full flex flex-col items-start gap-5">
                {/* Step number + icon */}
                <div className="relative">
                  <div className={`w-14 h-14 rounded-2xl bg-gradient-to-br ${step.color} ${step.shadow} flex items-center justify-center text-2xl`}>
                    {step.icon}
                  </div>
                  <div className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-white border-2 border-steel-grey flex items-center justify-center">
                    <span className="text-[9px] font-black text-care-blue">{step.num}</span>
                  </div>
                </div>

                <div>
                  <h3 className="font-montserrat font-bold text-xl text-ink-black mb-2">{step.title}</h3>
                  <p className="text-ink-black/60 text-sm leading-relaxed">{step.description}</p>
                </div>

                {/* Bottom gradient line */}
                <div className={`w-12 h-1 rounded-full bg-gradient-to-r ${step.color} mt-auto`} />
              </div>
            </motion.div>
          ))}
        </div>

        {/* Bottom CTA */}
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6, delay: 0.8 }}
          className="text-center mt-14"
        >
          <a href="/sign-up" className="btn-primary">
            Start Your Free Consultation →
          </a>
        </motion.div>
      </div>
    </section>
  )
}

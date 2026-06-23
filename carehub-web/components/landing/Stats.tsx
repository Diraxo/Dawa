'use client'

import { motion, useInView } from 'framer-motion'
import { useRef } from 'react'

const stats = [
  {
    value: '100%',
    label: 'Verified Doctors',
    icon: '✅',
    sub: 'Every doctor is board-certified and license-checked',
  },
  {
    value: '3',
    label: 'Ways to Consult',
    icon: '💬',
    sub: 'Chat, Phone, or Video — your choice',
  },
  {
    value: '4',
    label: 'Countries Served',
    icon: '🌍',
    sub: 'Ethiopia, Rwanda, United States & Afghanistan',
  },
  {
    value: '24/7',
    label: 'Always Available',
    icon: '⏰',
    sub: 'Round-the-clock access to healthcare',
  },
]

export default function Stats() {
  const ref = useRef(null)
  const inView = useInView(ref, { once: true, margin: '-80px' })

  return (
    <section className="section-padding bg-gradient-dark relative overflow-hidden" ref={ref}>
      {/* Background orbs */}
      <div className="absolute inset-0 pointer-events-none">
        <div
          className="absolute -bottom-32 -left-32 w-96 h-96 rounded-full"
          style={{ background: 'radial-gradient(circle, rgba(26,69,152,0.4) 0%, transparent 70%)', filter: 'blur(60px)' }}
        />
        <div
          className="absolute -top-32 -right-32 w-96 h-96 rounded-full"
          style={{ background: 'radial-gradient(circle, rgba(0,191,165,0.3) 0%, transparent 70%)', filter: 'blur(60px)' }}
        />
      </div>

      <div className="container-site relative z-10">
        <motion.div
          initial={{ opacity: 0, y: 32 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.7 }}
          className="text-center mb-16"
        >
          <h2 className="font-montserrat font-black text-4xl md:text-5xl text-white mb-4">
            Why Patients{' '}
            <span className="gradient-interactive-text">Trust Dawa</span>
          </h2>
          <p className="text-white/50 text-lg">
            Quality care backed by real commitments — not marketing numbers.
          </p>
        </motion.div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
          {stats.map((s, i) => (
            <motion.div
              key={s.label}
              initial={{ opacity: 0, y: 32 }}
              animate={inView ? { opacity: 1, y: 0 } : {}}
              transition={{ duration: 0.6, delay: 0.1 + i * 0.12 }}
              className="glass rounded-3xl p-8 text-center flex flex-col items-center gap-3"
            >
              <div className="text-4xl mb-1">{s.icon}</div>
              <span className="font-montserrat font-black text-5xl md:text-6xl gradient-hero-text">
                {s.value}
              </span>
              <p className="text-white font-semibold text-sm">{s.label}</p>
              <p className="text-white/40 font-medium text-xs text-center leading-snug">{s.sub}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  )
}

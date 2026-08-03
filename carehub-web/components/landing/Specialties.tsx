'use client'

import { motion, useInView } from 'framer-motion'
import { useRef } from 'react'

const specialties = [
  { icon: '🫀', name: 'Cardiology' },
  { icon: '🧠', name: 'Neurology' },
  { icon: '🦷', name: 'Dentistry' },
  { icon: '👁️', name: 'Ophthalmology' },
  { icon: '🩺', name: 'General Practice' },
  { icon: '👶', name: 'Pediatrics' },
  { icon: '🧬', name: 'Dermatology' },
  { icon: '🦴', name: 'Orthopedics' },
  { icon: '🧘', name: 'Psychiatry' },
  { icon: '💊', name: 'Internal Medicine' },
  { icon: '🤰', name: 'Gynecology' },
  { icon: '👂', name: 'ENT' },
]

export default function Specialties() {
  const ref = useRef(null)
  const inView = useInView(ref, { once: true, margin: '-80px' })

  return (
    <section id="specialties" className="section-padding bg-white" ref={ref}>
      <div className="container-site">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 32 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.7 }}
          className="text-center mb-14"
        >
          <span className="inline-block px-4 py-1.5 rounded-full bg-care-blue/8 text-care-blue text-xs font-bold uppercase tracking-widest mb-4">
            Specialties
          </span>
          <h2 className="font-montserrat font-black text-4xl md:text-5xl text-ink-black mb-4">
            Expert Doctors in{' '}
            <span className="gradient-interactive-text">Every Field</span>
          </h2>
          <p className="text-ink-black/60 text-lg max-w-[500px] mx-auto">
            From general check-ups to specialized care — we have the right doctor for you.
          </p>
        </motion.div>

        {/* Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
          {specialties.map((sp, i) => (
            <motion.button
              key={sp.name}
              initial={{ opacity: 0, scale: 0.9 }}
              animate={inView ? { opacity: 1, scale: 1 } : {}}
              transition={{ duration: 0.4, delay: 0.05 * i }}
              whileHover={{ y: -6, boxShadow: '0 12px 32px rgba(41,98,255,0.15)' }}
              className="card p-4 flex flex-col items-center gap-2.5 cursor-pointer border border-transparent hover:border-teal-green/30 transition-all duration-200 group"
            >
              <div className="w-12 h-12 rounded-2xl bg-cloud-grey flex items-center justify-center text-2xl group-hover:bg-gradient-to-br group-hover:from-care-blue/10 group-hover:to-teal-green/10 transition-all">
                {sp.icon}
              </div>
              <div className="text-center">
                <p className="font-montserrat font-semibold text-xs text-ink-black leading-tight">{sp.name}</p>
              </div>
            </motion.button>
          ))}
        </div>

        {/* View all */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={inView ? { opacity: 1 } : {}}
          transition={{ delay: 0.7 }}
          className="text-center mt-10"
        >
          <a href="/patient/doctors" className="btn-outline">
            View All Specialties
          </a>
        </motion.div>
      </div>
    </section>
  )
}

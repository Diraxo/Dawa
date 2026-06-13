'use client'

import { motion, useInView } from 'framer-motion'
import { useRef } from 'react'

const testimonials = [
  {
    name: 'Fatima Al-Hassan',
    role: 'Patient · Addis Ababa',
    avatar: 'FA',
    rating: 5,
    text: "I got a video consultation with a cardiologist within 10 minutes. The doctor was thorough, patient, and gave me a full summary at the end. CareHub is changing healthcare in Ethiopia.",
    color: 'from-care-blue to-int-blue',
  },
  {
    name: 'Dr. Meseret Tadesse',
    role: 'General Practitioner · CareHub Doctor',
    avatar: 'MT',
    rating: 5,
    text: "I've grown my patient base by 3x since joining CareHub. The platform handles everything — scheduling, payments, even consultation notes. I just focus on caring for my patients.",
    color: 'from-int-blue to-teal-green',
  },
  {
    name: 'Samuel Bekele',
    role: 'Patient · Kigali, Rwanda',
    avatar: 'SB',
    rating: 5,
    text: "Living abroad, finding a doctor who speaks my language was nearly impossible. CareHub solved that instantly. I had a consultation in Amharic — incredible experience.",
    color: 'from-teal-green to-emerald-400',
  },
  {
    name: 'Hana Girma',
    role: 'Patient · Dire Dawa',
    avatar: 'HG',
    rating: 5,
    text: "The chat consultation was perfect for my busy schedule. My prescription was sent digitally and I had my diagnosis summary in my email within an hour of the consultation ending.",
    color: 'from-care-blue to-teal-green',
  },
  {
    name: 'Dr. Amir Khalil',
    role: 'Pediatrician · CareHub Doctor',
    avatar: 'AK',
    rating: 5,
    text: "The doctor dashboard is intuitive and the real-time consultation tools are excellent. My patients love being able to connect via video from home instead of bringing sick children to a clinic.",
    color: 'from-int-blue to-care-blue',
  },
  {
    name: 'Tigist Alemu',
    role: 'Patient · Bahir Dar',
    avatar: 'TA',
    rating: 5,
    text: "I was skeptical at first, but the doctor I connected with was incredibly professional. The 30-second acceptance notification was thrilling — I felt like a priority patient immediately.",
    color: 'from-teal-green to-int-blue',
  },
]

function Stars({ n }: { n: number }) {
  return (
    <div className="flex gap-0.5">
      {Array.from({ length: n }).map((_, i) => (
        <span key={i} className="text-yellow-400 text-sm">★</span>
      ))}
    </div>
  )
}

export default function Testimonials() {
  const ref = useRef(null)
  const inView = useInView(ref, { once: true, margin: '-80px' })

  return (
    <section className="section-padding bg-cloud-grey" ref={ref}>
      <div className="container-site">
        <motion.div
          initial={{ opacity: 0, y: 32 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.7 }}
          className="text-center mb-14"
        >
          <span className="inline-block px-4 py-1.5 rounded-full bg-teal-green/10 text-teal-green text-xs font-bold uppercase tracking-widest mb-4">
            What People Say
          </span>
          <h2 className="font-montserrat font-black text-4xl md:text-5xl text-ink-black mb-4">
            Loved by Patients{' '}
            <span className="gradient-hero-text">&amp; Doctors Alike</span>
          </h2>
          <p className="text-ink-black/60 text-lg max-w-[480px] mx-auto">
            Don&apos;t take our word for it — hear from the people who use CareHub every day.
          </p>
        </motion.div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {testimonials.map((t, i) => (
            <motion.div
              key={t.name}
              initial={{ opacity: 0, y: 40 }}
              animate={inView ? { opacity: 1, y: 0 } : {}}
              transition={{ duration: 0.55, delay: 0.08 * i }}
              className="card card-hover p-6 flex flex-col gap-4"
            >
              <Stars n={t.rating} />
              <p className="text-ink-black/75 text-sm leading-relaxed flex-1">&ldquo;{t.text}&rdquo;</p>
              <div className="flex items-center gap-3 pt-2 border-t border-steel-grey">
                <div className={`w-10 h-10 rounded-full bg-gradient-to-br ${t.color} flex items-center justify-center flex-shrink-0`}>
                  <span className="text-white font-bold text-xs">{t.avatar}</span>
                </div>
                <div>
                  <p className="font-montserrat font-bold text-sm text-ink-black">{t.name}</p>
                  <p className="text-ink-black/50 text-[11px]">{t.role}</p>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  )
}

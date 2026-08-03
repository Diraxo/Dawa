'use client'

import React from 'react'
import { motion } from 'framer-motion'
import Link from 'next/link'
import { useUser } from '@clerk/nextjs'

const consultTypes = [
  { icon: '💬', label: 'Chat', color: 'from-blue-500 to-int-blue' },
  { icon: '📞', label: 'Call', color: 'from-care-blue to-teal-green' },
  { icon: '🎥', label: 'Video', color: 'from-teal-green to-emerald-400' },
]

const badges = [
  { icon: '✅', text: 'Verified Doctors' },
  { icon: '⚡', text: 'Connect in Minutes' },
  { icon: '🔒', text: 'HIPAA Compliant' },
]

type StatCard = { top: string; left?: string; right?: string; content: React.ReactNode }

const statCards: StatCard[] = [
  {
    top: '8%', left: '0%',
    content: (
      <div className="flex items-center gap-2">
        <div className="w-8 h-8 rounded-full bg-gradient-hero flex items-center justify-center">
          <span className="text-white text-xs font-bold">👨‍⚕️</span>
        </div>
        <div>
          <p className="text-[16px] font-black gradient-hero-text leading-tight">500+</p>
          <p className="text-[10px] text-ink-black/60 font-medium">Doctors</p>
        </div>
      </div>
    ),
  },
  {
    top: '40%', left: '0%',
    content: (
      <div className="flex items-center gap-2">
        <div className="w-8 h-8 rounded-full bg-gradient-interactive flex items-center justify-center">
          <span className="text-white text-xs font-bold">🧑</span>
        </div>
        <div>
          <p className="text-[16px] font-black gradient-interactive-text leading-tight">10k+</p>
          <p className="text-[10px] text-ink-black/60 font-medium">Patient Cases</p>
        </div>
      </div>
    ),
  },
  {
    top: '70%', left: '0%',
    content: (
      <div className="flex items-center gap-2">
        <span className="text-xl">⭐</span>
        <div>
          <p className="text-[16px] font-black text-ink-black leading-tight">4.9</p>
          <p className="text-[10px] text-ink-black/60 font-medium">Rating</p>
        </div>
      </div>
    ),
  },
  {
    top: '14%', right: '0%',
    content: (
      <div className="flex items-center gap-2">
        <span className="text-xl">🌍</span>
        <div>
          <p className="text-[16px] font-black text-ink-black leading-tight">4</p>
          <p className="text-[10px] text-ink-black/60 font-medium">Countries</p>
        </div>
      </div>
    ),
  },
  {
    top: '52%', right: '0%',
    content: (
      <div className="flex items-center gap-2">
        <div className="w-8 h-8 rounded-full bg-gradient-interactive flex items-center justify-center">
          <span className="text-white text-xs">✅</span>
        </div>
        <div>
          <p className="text-[16px] font-black gradient-interactive-text leading-tight">200+</p>
          <p className="text-[10px] text-ink-black/60 font-medium">Specialists</p>
        </div>
      </div>
    ),
  },
]

export default function Hero() {
  const { isSignedIn, isLoaded } = useUser()

  return (
    <section id="hero" className="relative min-h-screen flex flex-col items-center justify-center overflow-hidden bg-gradient-dark pt-[72px]">
      {/* Animated orbs */}
      <motion.div
        animate={{ scale: [1, 1.15, 1], opacity: [0.5, 0.7, 0.5] }}
        transition={{ duration: 8, repeat: Infinity, ease: 'easeInOut' }}
        className="absolute bottom-0 left-0 w-[600px] h-[600px] rounded-full"
        style={{ background: 'radial-gradient(circle, rgba(26,69,152,0.5) 0%, transparent 70%)', filter: 'blur(60px)' }}
      />
      <motion.div
        animate={{ scale: [1, 1.2, 1], opacity: [0.4, 0.6, 0.4] }}
        transition={{ duration: 10, repeat: Infinity, ease: 'easeInOut', delay: 2 }}
        className="absolute top-0 right-0 w-[500px] h-[500px] rounded-full"
        style={{ background: 'radial-gradient(circle, rgba(0,191,165,0.4) 0%, transparent 70%)', filter: 'blur(60px)' }}
      />

      {/* Faint grid */}
      <div className="absolute inset-0 opacity-[0.03]"
        style={{ backgroundImage: 'linear-gradient(rgba(255,255,255,.5) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.5) 1px, transparent 1px)', backgroundSize: '60px 60px' }} />

      <div className="container-site relative z-10 flex flex-col lg:flex-row items-center gap-16 py-20">
        {/* Left: text */}
        <div className="flex-1 text-center lg:text-left pb-12 lg:pb-0">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2, duration: 0.6 }}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-full glass mb-6"
          >
            <span className="text-teal-green text-xs font-bold uppercase tracking-widest">● Live</span>
            <span className="text-white/70 text-xs font-medium">Doctors available right now</span>
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.35, duration: 0.7 }}
            className="font-montserrat font-black text-4xl sm:text-5xl xl:text-6xl leading-[1.1] text-white mb-6"
          >
            Trusted Care.{' '}
            <span className="gradient-interactive-text">Anywhere.</span>
            <br />
            Always.
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5, duration: 0.7 }}
            className="font-montserrat text-lg text-white/65 leading-relaxed max-w-[520px] mx-auto lg:mx-0 mb-8"
          >
            Connect with verified, board-certified doctors in minutes — via chat, phone, or video call. Healthcare that fits your life.
          </motion.p>

          {/* Consult type pills */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.62, duration: 0.6 }}
            className="flex items-center gap-3 justify-center lg:justify-start mb-10"
          >
            {consultTypes.map(ct => (
              <div key={ct.label} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full glass">
                <span>{ct.icon}</span>
                <span className="text-white text-xs font-semibold">{ct.label}</span>
              </div>
            ))}
          </motion.div>

          {/* CTA */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.75, duration: 0.6 }}
            className="flex flex-col sm:flex-row gap-3 justify-center lg:justify-start mb-10"
          >
            {isLoaded && isSignedIn ? (
              <Link href="/dashboard" className="btn-primary h-[52px] px-8 text-base">
                Go to Dashboard →
              </Link>
            ) : (
              <>
                <Link href="/sign-up" className="btn-primary h-[52px] px-8 text-base">
                  Start Your Consultation →
                </Link>
                <Link href="/sign-in" className="btn-outline h-[52px] px-8 text-base bg-white/10 border-white/20 text-white hover:bg-white/20 hover:border-white/30">
                  Sign In
                </Link>
              </>
            )}
          </motion.div>

          {/* Trust badges */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.9, duration: 0.6 }}
            className="flex flex-wrap gap-4 justify-center lg:justify-start"
          >
            {badges.map(b => (
              <div key={b.text} className="flex items-center gap-1.5 text-white/60 text-xs font-medium">
                <span>{b.icon}</span>
                <span>{b.text}</span>
              </div>
            ))}
          </motion.div>
        </div>

        {/* Right: phone mockup */}
        <motion.div
          initial={{ opacity: 0, x: 60 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.4, duration: 0.8, ease: 'easeOut' }}
          className="flex-shrink-0 relative w-[280px] lg:w-[320px]"
        >
          <motion.div
            animate={{ y: [0, -12, 0] }}
            transition={{ duration: 6, repeat: Infinity, ease: 'easeInOut' }}
            className="relative"
          >
            {/* Phone frame */}
            <div className="relative mx-auto w-[260px] h-[520px] rounded-[40px] overflow-hidden border-2 border-white/20 shadow-2xl"
              style={{ background: 'linear-gradient(135deg, #0d1b3e 0%, #07111f 100%)' }}>
              {/* Status bar */}
              <div className="flex justify-between px-6 pt-4 pb-2">
                <span className="text-white/60 text-[10px] font-semibold">9:41</span>
                <div className="flex gap-1 items-center">
                  <div className="w-3 h-1.5 rounded-sm border border-white/60">
                    <div className="w-2/3 h-full bg-white/60 rounded-sm" />
                  </div>
                </div>
              </div>
              {/* Notch */}
              <div className="absolute top-2 left-1/2 -translate-x-1/2 w-20 h-5 bg-black rounded-full" />

              {/* App content */}
              <div className="px-4 pt-2">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <p className="text-white/50 text-[10px]">Good morning 👋</p>
                    <p className="text-white font-bold text-sm">Abdirahman</p>
                  </div>
                  <div className="w-8 h-8 rounded-full bg-gradient-interactive flex items-center justify-center">
                    <span className="text-white text-[10px] font-bold">AB</span>
                  </div>
                </div>

                {/* Search */}
                <div className="flex items-center gap-2 bg-white/10 rounded-xl px-3 py-2 mb-4">
                  <span className="text-white/40 text-xs">🔍</span>
                  <span className="text-white/40 text-[10px]">Search doctors, specialties…</span>
                </div>

                {/* Hero card */}
                <div className="rounded-2xl p-3 mb-4" style={{ background: 'linear-gradient(135deg, #1A4598, #00BFA5)' }}>
                  <p className="text-white font-bold text-sm mb-1">Talk to a Doctor Now</p>
                  <p className="text-white/70 text-[10px] mb-3">Available 24/7 · Avg. wait &lt;2 min</p>
                  <div className="bg-white/20 rounded-lg px-3 py-1.5 w-fit">
                    <span className="text-white font-semibold text-[10px]">Start Consultation →</span>
                  </div>
                </div>

                {/* Doctor cards */}
                <p className="text-white/50 text-[9px] font-bold uppercase tracking-wider mb-2">Available Now</p>
                {[
                  { name: 'Dr. Aisha M.', spec: 'General Practice', rating: '4.9', initials: 'AM' },
                  { name: 'Dr. Kebede T.', spec: 'Cardiologist', rating: '4.8', initials: 'KT' },
                ].map(d => (
                  <div key={d.name} className="flex items-center gap-2 bg-white/8 rounded-xl p-2.5 mb-2">
                    <div className="w-8 h-8 rounded-full bg-gradient-interactive flex-shrink-0 flex items-center justify-center">
                      <span className="text-white font-bold text-[9px]">{d.initials}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-white font-semibold text-[10px]">{d.name}</p>
                      <p className="text-white/50 text-[9px]">{d.spec}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-yellow-400 text-[9px]">★ {d.rating}</p>
                      <div className="w-1.5 h-1.5 rounded-full bg-teal-green mt-0.5 ml-auto" />
                    </div>
                  </div>
                ))}
              </div>

              {/* Bottom nav */}
              <div className="absolute bottom-0 left-0 right-0 border-t border-white/10 bg-black/40 backdrop-blur-md flex justify-around py-3 px-4">
                {['🏠','👨‍⚕️','📅','💬','👤'].map((ic, i) => (
                  <div key={i} className="flex flex-col items-center gap-0.5">
                    <span className="text-sm">{ic}</span>
                    {i === 0 && <div className="w-1 h-1 rounded-full bg-teal-green" />}
                  </div>
                ))}
              </div>
            </div>

            {/* Floating notification */}
            <motion.div
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 1.2 }}
              className="absolute -bottom-4 -left-10 glass-light rounded-2xl px-3.5 py-2.5 shadow-card-lg w-[160px]"
            >
              <div className="flex items-center gap-2">
                <span className="text-base">🩺</span>
                <div>
                  <p className="text-[10px] font-bold text-ink-black">Doctor Connected!</p>
                  <p className="text-[9px] text-teal-green font-medium">Consultation active</p>
                </div>
              </div>
            </motion.div>

            {/* Stat cards — inside animated div so they float with the phone */}
            {statCards.map((sc, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 1 + i * 0.15, duration: 0.5 }}
                className="absolute glass-light rounded-2xl px-3 py-2 shadow-card-lg hidden lg:block"
                style={{ top: sc.top, left: sc.left, right: sc.right }}
              >
                {sc.content}
              </motion.div>
            ))}
          </motion.div>
        </motion.div>
      </div>

      {/* Scroll indicator */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1.5 }}
        className="absolute bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-center gap-1.5"
      >
        <span className="text-white/40 text-xs font-medium">Scroll to explore</span>
        <motion.div
          animate={{ y: [0, 6, 0] }}
          transition={{ duration: 1.5, repeat: Infinity }}
          className="w-5 h-8 rounded-full border-2 border-white/20 flex justify-center pt-1.5"
        >
          <div className="w-1 h-2 rounded-full bg-white/40" />
        </motion.div>
      </motion.div>
    </section>
  )
}

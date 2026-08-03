import Link from 'next/link'
import LogoMark from '@/components/ui/LogoMark'

const STATS = [
  { value: '500+', label: 'Verified Doctors' },
  { value: '10K+', label: 'Patients Served' },
  { value: '4.9★', label: 'App Rating' },
  { value: '3', label: 'Consultation Types' },
]

const VALUES = [
  { icon: '🛡️', title: 'Trust & Safety', desc: 'Every doctor is verified with medical license and ID before joining the platform.' },
  { icon: '🌍', title: 'Accessibility', desc: 'Quality healthcare available from anywhere, on any device, anytime.' },
  { icon: '🔒', title: 'Privacy First', desc: 'Your health data is encrypted and never shared with third parties.' },
  { icon: '⚡', title: 'Speed & Reliability', desc: 'Connect with a doctor in under a minute, any time of day.' },
]

const HOW_IT_WORKS = [
  { step: 1, icon: '👤', title: 'Create your account', desc: 'Sign up with your email or Google account in seconds.' },
  { step: 2, icon: '🔍', title: 'Find a doctor', desc: 'Browse verified doctors by specialty, rating, or price.' },
  { step: 3, icon: '📅', title: 'Book a consultation', desc: 'Choose chat, phone, or video — instantly or scheduled.' },
  { step: 4, icon: '🩺', title: 'Consult with your doctor', desc: 'Get professional medical advice in real time.' },
  { step: 5, icon: '📋', title: 'Receive your summary', desc: 'Get diagnosis, prescription, and follow-up notes after each session.' },
]

export default function PatientAboutPage() {
  return (
    <div className="p-8 max-w-3xl">
      {/* Hero */}
      <div
        className="rounded-3xl p-10 mb-8 flex flex-col items-center text-center"
        style={{ background: 'linear-gradient(135deg, #070E27, #1A4598 30%, #00BFA5 100%)' }}
      >
        <LogoMark size={64} variant="light" />
        <h1 className="font-montserrat font-black text-4xl text-white mt-4 mb-1">
          DA<span style={{ color: '#00BFA5' }}>WA</span>
        </h1>
        <p className="text-white/60 text-sm tracking-widest uppercase">TRUSTED CARE. ANYWHERE. ALWAYS.</p>
        <p className="text-white/40 text-xs mt-4">Version 1.0.0</p>
      </div>

      {/* Mission */}
      <div className="card p-6 mb-6">
        <h2 className="font-montserrat font-bold text-lg text-ink-black mb-3">Our Mission</h2>
        <p className="text-ink-black/70 text-sm leading-relaxed">
          Dawa was built to eliminate the barriers between people and quality healthcare. We connect patients
          with verified doctors through secure chat, phone, and video consultations — making professional
          medical advice accessible to everyone, everywhere, at any time.
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        {STATS.map(s => (
          <div key={s.label} className="card p-4 text-center">
            <p className="font-montserrat font-black text-2xl text-ink-black">{s.value}</p>
            <p className="text-xs text-ink-black/40 mt-1">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Core Values */}
      <div className="card p-6 mb-6">
        <h2 className="font-montserrat font-bold text-lg text-ink-black mb-4">Core Values</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {VALUES.map(v => (
            <div key={v.title} className="flex gap-3">
              <div className="w-10 h-10 rounded-2xl bg-cloud-grey flex items-center justify-center text-xl flex-shrink-0">{v.icon}</div>
              <div>
                <p className="font-montserrat font-bold text-sm text-ink-black">{v.title}</p>
                <p className="text-xs text-ink-black/50 mt-1 leading-relaxed">{v.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* How it works */}
      <div className="card p-6 mb-6">
        <h2 className="font-montserrat font-bold text-lg text-ink-black mb-5">How Dawa Works</h2>
        <div className="flex flex-col gap-4">
          {HOW_IT_WORKS.map((step, idx) => (
            <div key={step.step} className="flex gap-4">
              <div className="flex flex-col items-center">
                <div
                  className="w-10 h-10 rounded-full flex items-center justify-center text-white font-black text-sm flex-shrink-0"
                  style={{ background: 'linear-gradient(135deg, #2962FF, #00BFA5)' }}
                >
                  {step.step}
                </div>
                {idx < HOW_IT_WORKS.length - 1 && <div className="w-px flex-1 bg-cloud-grey mt-2" />}
              </div>
              <div className="pb-4">
                <p className="font-montserrat font-bold text-sm text-ink-black">{step.icon} {step.title}</p>
                <p className="text-xs text-ink-black/50 mt-1">{step.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Contact */}
      <div className="card p-6">
        <h2 className="font-montserrat font-bold text-lg text-ink-black mb-4">Contact Us</h2>
        <div className="flex flex-col gap-2 text-sm text-ink-black/70">
          <p>📧 <a href="mailto:support@dawa.app" className="text-teal-green hover:underline">support@dawa.app</a></p>
          <p>🌐 <a href="https://www.dawa.app" className="text-teal-green hover:underline">www.dawa.app</a></p>
          <p>📍 Addis Ababa, Ethiopia</p>
        </div>
        <div className="flex gap-3 mt-5">
          <Link href="/privacy" className="text-xs text-ink-black/40 hover:text-ink-black">Privacy Policy</Link>
          <span className="text-ink-black/20">·</span>
          <Link href="/terms" className="text-xs text-ink-black/40 hover:text-ink-black">Terms of Service</Link>
        </div>
        <p className="text-[10px] text-ink-black/25 mt-3">© 2026 Dawa. All rights reserved.</p>
      </div>
    </div>
  )
}

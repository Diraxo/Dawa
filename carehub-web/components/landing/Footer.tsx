import Link from 'next/link'
import LogoMark from '@/components/ui/LogoMark'

const cols = [
  {
    title: 'Platform',
    links: [
      { label: 'How It Works', href: '#how-it-works' },
      { label: 'For Patients', href: '/sign-up' },
      { label: 'For Doctors', href: '#for-doctors' },
      { label: 'Specialties', href: '#specialties' },
    ],
  },
  {
    title: 'Consultations',
    links: [
      { label: 'Chat Consultation', href: '/sign-up' },
      { label: 'Phone Consultation', href: '/sign-up' },
      { label: 'Video Consultation', href: '/sign-up' },
      { label: 'Browse Doctors', href: '/patient/doctors' },
    ],
  },
  {
    title: 'Company',
    links: [
      { label: 'About Dawa', href: '/about' },
      { label: 'Privacy Policy', href: '/privacy' },
      { label: 'Terms of Service', href: '/terms' },
      { label: 'Contact Us', href: '/contact' },
    ],
  },
]

export default function Footer() {
  return (
    <footer className="bg-gradient-dark text-white">
      <div className="container-site pt-20 pb-16">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-12 mb-14">
          {/* Brand */}
          <div className="flex flex-col gap-5 pt-4">
            <Link href="/" className="flex items-center gap-2.5">
              <LogoMark size={36} />
              <span className="font-montserrat font-bold text-xl">
                DA<span className="text-teal-green">WA</span>
              </span>
            </Link>
            <p className="text-white/50 text-sm leading-relaxed">
              Trusted Care. Anywhere. Always.
              <br />
              Connecting patients with verified doctors through chat, phone, and video consultations.
            </p>
            <div className="flex gap-3">
              {[
                { icon: '📧', label: 'Email' },
                { icon: '🐦', label: 'Twitter' },
                { icon: '💼', label: 'LinkedIn' },
              ].map(s => (
                <button
                  key={s.label}
                  aria-label={s.label}
                  className="w-9 h-9 rounded-xl glass flex items-center justify-center hover:bg-white/15 transition-colors text-base"
                >
                  {s.icon}
                </button>
              ))}
            </div>
          </div>

          {/* Link columns */}
          {cols.map(col => (
            <div key={col.title} className="pl-6 pt-4 border-l border-white/10">
              <h4 className="font-montserrat font-bold text-sm uppercase tracking-widest text-white/80 mb-5">{col.title}</h4>
              <ul className="flex flex-col gap-3">
                {col.links.map(l => (
                  <li key={l.label}>
                    <a
                      href={l.href}
                      className="text-white/50 text-sm hover:text-teal-green transition-colors"
                    >
                      {l.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Divider */}
        <div className="border-t border-white/10 pt-8 flex flex-col md:flex-row items-center justify-between gap-4 ">
          <p className="text-white/60 text-xs mb-2">
            © {new Date().getFullYear()} Dawa. All rights reserved.
          </p>
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-teal-green animate-pulse" />
            <span className="text-white/40 text-xs">All systems operational</span>
          </div>
        </div>
      </div>
    </footer>
  )
}

'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useClerk, useUser } from '@clerk/nextjs'
import { Home, Stethoscope, Calendar, MessageCircle, User, LogOut, FileText, Bell, HelpCircle, Info, CreditCard } from 'lucide-react'
import { getInitials } from '@/lib/utils'
import LogoMark from '@/components/ui/LogoMark'

const navItems = [
  { icon: Home, label: 'Home', href: '/patient' },
  { icon: Stethoscope, label: 'Find Doctors', href: '/patient/doctors' },
  { icon: Calendar, label: 'Appointments', href: '/patient/appointments' },
  { icon: MessageCircle, label: 'Messages', href: '/patient/messages' },
  { icon: User, label: 'Profile', href: '/patient/profile' },
]

const secondaryItems = [
  { icon: FileText, label: 'Medical Records', href: '/patient/medical-records' },
  { icon: CreditCard, label: 'Payment Methods', href: '/patient/payment-methods' },
  { icon: Bell, label: 'Notifications', href: '/patient/notification-settings' },
  { icon: HelpCircle, label: 'Help & Support', href: '/patient/help-support' },
  { icon: Info, label: 'About Dawa', href: '/patient/about' },
]

export default function PatientSidebar() {
  const pathname = usePathname()
  const { user } = useUser()
  const { signOut } = useClerk()

  return (
    <aside className="w-64 min-h-screen bg-white border-r border-steel-grey flex flex-col">
      {/* Logo */}
      <div className="p-5 border-b border-steel-grey">
        <Link href="/patient" className="flex items-center gap-2.5">
          <LogoMark size={32} variant="dark" />
          <span className="font-montserrat font-bold text-lg text-ink-black">
            DA<span className="text-teal-green">WA</span>
          </span>
        </Link>
      </div>

      {/* User info */}
      {user && (
        <div className="px-5 py-4 border-b border-steel-grey">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-gradient-hero flex items-center justify-center text-white font-bold text-sm">
              {getInitials(user.fullName ?? user.emailAddresses[0]?.emailAddress ?? 'U')}
            </div>
            <div className="min-w-0">
              <p className="font-montserrat font-bold text-sm text-ink-black truncate">
                {user.fullName ?? 'Patient'}
              </p>
              <p className="text-ink-black/40 text-xs truncate">{user.emailAddresses[0]?.emailAddress}</p>
            </div>
          </div>
        </div>
      )}

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 flex flex-col gap-1 overflow-y-auto">
        {navItems.map(item => {
          const active = item.href === '/patient' ? pathname === '/patient' : pathname.startsWith(item.href)
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all ${
                active
                  ? 'bg-gradient-interactive text-white shadow-blue font-semibold'
                  : 'text-ink-black/60 hover:text-ink-black hover:bg-cloud-grey'
              }`}
            >
              <item.icon size={18} />
              <span className="font-montserrat text-sm">{item.label}</span>
            </Link>
          )
        })}

        <div className="my-2 h-px bg-steel-grey/50" />

        {secondaryItems.map(item => {
          const active = pathname.startsWith(item.href)
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 px-3 py-2 rounded-xl transition-all ${
                active
                  ? 'bg-gradient-interactive text-white shadow-blue font-semibold'
                  : 'text-ink-black/50 hover:text-ink-black hover:bg-cloud-grey'
              }`}
            >
              <item.icon size={16} />
              <span className="font-montserrat text-[13px]">{item.label}</span>
            </Link>
          )
        })}
      </nav>

      <div className="p-4 border-t border-steel-grey">
        <button
          onClick={() => signOut({ redirectUrl: '/' })}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-ink-black/50 hover:text-danger hover:bg-danger/8 transition-all"
        >
          <LogOut size={18} />
          <span className="font-montserrat text-sm">Sign Out</span>
        </button>
      </div>
    </aside>
  )
}

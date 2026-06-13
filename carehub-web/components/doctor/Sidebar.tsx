'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useClerk, useUser } from '@clerk/nextjs'
import { Home, ClipboardList, Calendar, MessageCircle, User, LogOut } from 'lucide-react'
import { getInitials } from '@/lib/utils'
import LogoMark from '@/components/ui/LogoMark'

const navItems = [
  { icon: Home, label: 'Home', href: '/doctor' },
  { icon: ClipboardList, label: 'Consultations', href: '/doctor/consultations' },
  { icon: Calendar, label: 'Schedule', href: '/doctor/schedule' },
  { icon: MessageCircle, label: 'Messages', href: '/doctor/messages' },
  { icon: User, label: 'Profile', href: '/doctor/profile' },
]

export default function DoctorSidebar() {
  const pathname = usePathname()
  const { user } = useUser()
  const { signOut } = useClerk()

  return (
    <aside className="w-64 min-h-screen bg-white border-r border-steel-grey flex flex-col">
      <div className="p-5 border-b border-steel-grey">
        <Link href="/doctor" className="flex items-center gap-2.5">
          <LogoMark size={32} />
          <span className="font-montserrat font-bold text-lg text-ink-black">
            CARE<span className="text-teal-green">HUB</span>
          </span>
        </Link>
      </div>

      {user && (
        <div className="px-5 py-4 border-b border-steel-grey">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-gradient-hero flex items-center justify-center text-white font-bold text-sm">
              {getInitials(user.fullName ?? 'Doctor')}
            </div>
            <div className="min-w-0">
              <p className="font-montserrat font-bold text-sm text-ink-black truncate">
                Dr. {user.fullName ?? 'Doctor'}
              </p>
              <p className="text-teal-green text-xs font-semibold">Healthcare Professional</p>
            </div>
          </div>
        </div>
      )}

      <nav className="flex-1 px-3 py-4 flex flex-col gap-1">
        {navItems.map(item => {
          const active = item.href === '/doctor' ? pathname === '/doctor' : pathname.startsWith(item.href)
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

'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useClerk } from '@clerk/nextjs'
import {
  LayoutDashboard, BadgeCheck, Stethoscope, Users,
  ClipboardList, Wallet, Settings, LogOut,
} from 'lucide-react'
import LogoMark from '@/components/ui/LogoMark'

const navItems = [
  { icon: LayoutDashboard, label: 'Dashboard', href: '/admin' },
  { icon: BadgeCheck, label: 'Approvals', href: '/admin/approvals', badge: true },
  { icon: Stethoscope, label: 'Doctors', href: '/admin/doctors' },
  { icon: Users, label: 'Patients', href: '/admin/patients' },
  { icon: ClipboardList, label: 'Consultations', href: '/admin/consultations' },
  { icon: Wallet, label: 'Payments', href: '/admin/payments' },
  { icon: Settings, label: 'Settings', href: '/admin/settings' },
]

export default function AdminSidebar() {
  const pathname = usePathname()
  const { signOut } = useClerk()

  return (
    <aside className="w-64 min-h-screen bg-gradient-dark flex flex-col border-r border-white/10">
      {/* Logo */}
      <div className="p-6 border-b border-white/10">
        <Link href="/admin" className="flex items-center gap-2.5">
          <LogoMark size={36} />
          <div>
            <p className="font-montserrat font-bold text-white text-base">
              CARE<span className="text-teal-green">HUB</span>
            </p>
            <p className="text-white/40 text-[10px] font-medium">Admin Panel</p>
          </div>
        </Link>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 flex flex-col gap-1">
        {navItems.map(item => {
          const active = item.href === '/admin' ? pathname === '/admin' : pathname.startsWith(item.href)
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all ${
                active
                  ? 'bg-gradient-interactive text-white shadow-blue font-semibold'
                  : 'text-white/60 hover:text-white hover:bg-white/8'
              }`}
            >
              <item.icon size={18} />
              <span className="font-montserrat text-sm flex-1">{item.label}</span>
              {item.badge && (
                <span className="w-2 h-2 rounded-full bg-warning" />
              )}
            </Link>
          )
        })}
      </nav>

      {/* Footer */}
      <div className="p-4 border-t border-white/10">
        <button
          onClick={() => signOut({ redirectUrl: '/sign-in' })}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-white/50 hover:text-white hover:bg-white/8 transition-all"
        >
          <LogOut size={18} />
          <span className="font-montserrat text-sm">Sign Out</span>
        </button>
      </div>
    </aside>
  )
}

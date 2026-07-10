'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useAuth, useClerk, useUser } from '@clerk/nextjs'
import { Home, ClipboardList, Calendar, MessageCircle, User, LogOut, Bell, HelpCircle, Info, Star, Shield, Wallet, FileText, TrendingUp } from 'lucide-react'
import { getAuthClient } from '@/lib/supabase'
import { getInitials, stripDrPrefix } from '@/lib/utils'
import LogoMark from '@/components/ui/LogoMark'

const navItems = [
  { icon: Home, label: 'Home', href: '/doctor' },
  { icon: ClipboardList, label: 'Consultations', href: '/doctor/consultations' },
  { icon: Calendar, label: 'Schedule', href: '/doctor/schedule' },
  { icon: MessageCircle, label: 'Messages', href: '/doctor/messages' },
  { icon: FileText, label: 'My Summaries', href: '/doctor/summaries' },
  { icon: TrendingUp, label: 'Performance', href: '/doctor/performance' },
  { icon: Wallet, label: 'Withdraw', href: '/doctor/withdraw' },
  { icon: User, label: 'Profile', href: '/doctor/profile' },
]

const secondaryItems = [
  { icon: Star, label: 'My Reviews', href: '/doctor/my-reviews' },
  { icon: Bell, label: 'Notifications', href: '/doctor/notification-settings' },
  { icon: HelpCircle, label: 'Help & Support', href: '/doctor/help-support' },
  { icon: Shield, label: 'Privacy Policy', href: '/doctor/privacy-policy' },
  { icon: Info, label: 'About Dawa', href: '/doctor/about-dawa' },
]

export default function DoctorSidebar() {
  const pathname = usePathname()
  const { user } = useUser()
  const { signOut } = useClerk()
  const { getToken } = useAuth()

  const handleSignOut = async () => {
    try {
      const token = await getToken()
      if (token) {
        // Mirrors the mobile app's logout handler (app/(doctor)/(tabs)/profile.tsx) —
        // RLS scopes this update to the caller's own doctor_profiles row.
        await getAuthClient(token).from('doctor_profiles').update({ is_online: false })
      }
    } catch {
      // best-effort; the server-side TTL sweep is the safety net
    }
    await signOut({ redirectUrl: '/' })
  }

  return (
    <aside className="w-64 min-h-screen bg-white border-r border-steel-grey flex flex-col">
      <div className="p-5 border-b border-steel-grey">
        <Link href="/doctor" className="flex items-center gap-2.5">
          <LogoMark size={32} variant="dark" />
          <span className="font-montserrat font-bold text-lg text-ink-black">
            DA<span className="text-teal-green">WA</span>
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
                Dr. {stripDrPrefix(user.fullName ?? 'Doctor')}
              </p>
              <p className="text-teal-green text-xs font-semibold">Healthcare Professional</p>
            </div>
          </div>
        </div>
      )}

      <nav className="flex-1 px-3 py-4 flex flex-col gap-1 overflow-y-auto" aria-label="Doctor navigation">
        {navItems.map(item => {
          const active = item.href === '/doctor' ? pathname === '/doctor' : pathname.startsWith(item.href)
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all ${
                active
                  ? 'bg-gradient-interactive text-white shadow-blue font-semibold'
                  : 'text-ink-black/60 hover:text-ink-black hover:bg-cloud-grey'
              }`}
            >
              <item.icon size={18} aria-hidden="true" />
              <span className="font-montserrat text-sm">{item.label}</span>
            </Link>
          )
        })}

        <div className="my-2 h-px bg-steel-grey/50" role="separator" />

        {secondaryItems.map(item => {
          const active = pathname.startsWith(item.href)
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              className={`flex items-center gap-3 px-3 py-2 rounded-xl transition-all ${
                active
                  ? 'bg-gradient-interactive text-white shadow-blue font-semibold'
                  : 'text-ink-black/50 hover:text-ink-black hover:bg-cloud-grey'
              }`}
            >
              <item.icon size={16} aria-hidden="true" />
              <span className="font-montserrat text-[13px]">{item.label}</span>
            </Link>
          )
        })}
      </nav>

      <div className="p-4 border-t border-steel-grey">
        <button
          onClick={handleSignOut}
          aria-label="Sign out of Dawa"
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-ink-black/50 hover:text-danger hover:bg-danger/8 transition-all"
        >
          <LogOut size={18} aria-hidden="true" />
          <span className="font-montserrat text-sm">Sign Out</span>
        </button>
      </div>
    </aside>
  )
}

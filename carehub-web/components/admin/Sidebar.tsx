'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useClerk } from '@clerk/nextjs'
import {
  LayoutDashboard, BadgeCheck, Stethoscope, Users,
  ClipboardList, Wallet, Settings, LogOut, Tags, Bell, ShieldCheck,
} from 'lucide-react'
import LogoMark from '@/components/ui/LogoMark'
import { supabase } from '@/lib/supabase'

interface PendingDoctor {
  id: string
  specialty: string
  created_at: string
  user: { full_name: string; email: string; profile_photo_url: string | null } | null
}

const NAV_ITEMS = [
  { icon: LayoutDashboard, label: 'Dashboard', href: '/admin', hasBadge: false },
  { icon: BadgeCheck, label: 'Approvals', href: '/admin/approvals', hasBadge: true },
  { icon: Stethoscope, label: 'Doctors', href: '/admin/doctors', hasBadge: false },
  { icon: Users, label: 'Patients', href: '/admin/patients', hasBadge: false },
  { icon: ClipboardList, label: 'Consultations', href: '/admin/consultations', hasBadge: false },
  { icon: Wallet, label: 'Payments', href: '/admin/payments', hasBadge: false },
  { icon: Tags, label: 'Specialties', href: '/admin/specialties', hasBadge: false },
  { icon: ShieldCheck, label: 'Audit Log', href: '/admin/audit', hasBadge: false },
  { icon: Settings, label: 'Settings', href: '/admin/settings', hasBadge: false },
]

export default function AdminSidebar() {
  const pathname = usePathname()
  const { signOut } = useClerk()
  const [pendingDoctors, setPendingDoctors] = useState<PendingDoctor[]>([])
  const [showNotifications, setShowNotifications] = useState(false)
  const bellRef = useRef<HTMLDivElement>(null)

  const pendingCount = pendingDoctors.length

  const fetchPending = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/pending-doctors')
      if (!res.ok) return
      const data: PendingDoctor[] = await res.json()
      setPendingDoctors(data)
    } catch {
      // silently ignore — sidebar is non-critical
    }
  }, [])

  useEffect(() => {
    fetchPending()

    // Remove stale channel if React Strict Mode already created one
    supabase.getChannels().forEach(ch => {
      if (ch.topic === 'realtime:admin-sidebar-pending') supabase.removeChannel(ch)
    })

    // Refresh count when new doctor registers or a pending doctor is updated
    const channel = supabase
      .channel('admin-sidebar-pending')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'doctor_profiles', filter: 'status=eq.pending' },
        () => { fetchPending() }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'doctor_profiles' },
        () => { fetchPending() }
      )
      .subscribe()

    // Instant sync when admin approves/rejects from the approvals page
    function onPendingChanged() { fetchPending() }
    window.addEventListener('pending-doctors-changed', onPendingChanged)

    return () => {
      supabase.removeChannel(channel)
      window.removeEventListener('pending-doctors-changed', onPendingChanged)
    }
  }, [fetchPending])

  // Close notification panel when clicking outside
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (bellRef.current && !bellRef.current.contains(e.target as Node)) {
        setShowNotifications(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  return (
    <aside className="w-64 min-h-screen bg-gradient-dark flex flex-col border-r border-white/10">
      {/* Logo + bell */}
      <div className="p-6 border-b border-white/10 flex items-center gap-2">
        <Link href="/admin" className="flex items-center gap-2.5 flex-1 min-w-0">
          <LogoMark size={36} />
          <div>
            <p className="font-montserrat font-bold text-white text-base">
              DA<span className="text-teal-green">WA</span>
            </p>
            <p className="text-white/40 text-[10px] font-medium">Admin Panel</p>
          </div>
        </Link>

        {/* Notification bell */}
        <div ref={bellRef} className="relative flex-shrink-0">
          <button
            onClick={() => setShowNotifications(v => !v)}
            className="relative w-9 h-9 rounded-xl flex items-center justify-center text-white/60 hover:text-white hover:bg-white/10 transition-all"
            title="Doctor approval requests"
          >
            <Bell size={18} />
            {pendingCount > 0 && (
              <span className="absolute top-1 right-1 min-w-[14px] h-3.5 px-0.5 rounded-full bg-warning text-[9px] font-black text-white flex items-center justify-center leading-none">
                {pendingCount > 99 ? '99+' : pendingCount}
              </span>
            )}
          </button>

          {/* Notification dropdown */}
          {showNotifications && (
            <div className="absolute top-full right-0 mt-2 w-72 bg-white rounded-2xl shadow-2xl overflow-hidden z-50 border border-steel-grey">
              <div className="px-4 py-3 border-b border-steel-grey flex items-center justify-between">
                <p className="font-montserrat font-bold text-sm text-ink-black">Doctor Requests</p>
                {pendingCount > 0 && (
                  <span className="text-[10px] font-bold text-warning bg-warning/15 px-2 py-0.5 rounded-full">
                    {pendingCount} pending
                  </span>
                )}
              </div>

              {pendingCount === 0 ? (
                <div className="px-4 py-6 text-center">
                  <p className="text-2xl mb-1">🎉</p>
                  <p className="text-sm text-ink-black/50">No pending requests</p>
                </div>
              ) : (
                <div className="max-h-72 overflow-y-auto">
                  {pendingDoctors.map(doc => (
                    <Link
                      key={doc.id}
                      href={`/admin/approvals#doctor-${doc.id}`}
                      onClick={() => setShowNotifications(false)}
                      className="flex items-center gap-3 px-4 py-3 hover:bg-cloud-grey border-b border-steel-grey/40 last:border-0 transition-colors"
                    >
                      <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-care-blue to-teal-green flex items-center justify-center text-white text-sm font-bold flex-shrink-0">
                        {doc.user?.full_name?.charAt(0) ?? '?'}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-sm text-ink-black truncate">
                          {doc.user?.full_name ?? 'Unknown'} requested approval
                        </p>
                        <p className="text-xs text-ink-black/50 truncate">
                          {doc.specialty} · {new Date(doc.created_at).toLocaleDateString()}
                        </p>
                      </div>
                      <span className="text-ink-black/30 flex-shrink-0 text-sm">→</span>
                    </Link>
                  ))}
                </div>
              )}

              <Link
                href="/admin/approvals"
                onClick={() => setShowNotifications(false)}
                className="block text-center px-4 py-2.5 text-xs font-semibold text-teal-green hover:bg-cloud-grey transition-colors border-t border-steel-grey"
              >
                View all approvals →
              </Link>
            </div>
          )}
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 flex flex-col gap-1">
        {NAV_ITEMS.map(item => {
          const active = item.href === '/admin'
            ? pathname === '/admin'
            : pathname.startsWith(item.href)
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
              {item.hasBadge && pendingCount > 0 && (
                <span className="min-w-[20px] h-5 px-1.5 rounded-full bg-warning text-[10px] font-black text-white flex items-center justify-center">
                  {pendingCount > 99 ? '99+' : pendingCount}
                </span>
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

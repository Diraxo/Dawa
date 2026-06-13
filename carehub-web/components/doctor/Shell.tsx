'use client'

import { usePathname } from 'next/navigation'
import DoctorSidebar from '@/components/doctor/Sidebar'
import AppointmentAlerts from '@/components/ui/AppointmentAlerts'
import ResponsiveShell from '@/components/ui/ResponsiveShell'
import RoleGuard from '@/components/ui/RoleGuard'

// Doctor section wrapper: role-guarded everywhere; the onboarding screens
// (register / under-review) render full-page without the dashboard sidebar.
export default function DoctorShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const onboarding =
    pathname.startsWith('/doctor/register') || pathname.startsWith('/doctor/under-review')

  return (
    <RoleGuard allow="doctor">
      {onboarding ? (
        children
      ) : (
        <ResponsiveShell sidebar={<DoctorSidebar />}>
          <AppointmentAlerts />
          {children}
        </ResponsiveShell>
      )}
    </RoleGuard>
  )
}

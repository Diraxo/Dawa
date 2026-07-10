'use client'

import { usePathname } from 'next/navigation'
import DoctorSidebar from '@/components/doctor/Sidebar'
import IncomingRequestOverlay from '@/components/doctor/IncomingRequestOverlay'
import AppointmentAlerts from '@/components/ui/AppointmentAlerts'
import NetworkBanner from '@/components/ui/NetworkBanner'
import ResponsiveShell from '@/components/ui/ResponsiveShell'
import RoleGuard from '@/components/ui/RoleGuard'
import DoctorConsultationRecovery from '@/components/doctor/DoctorConsultationRecovery'
import StatusAckNotice from '@/components/doctor/StatusAckNotice'

// Doctor section wrapper: role-guarded everywhere; the onboarding screens
// (register / under-review) render full-page without the dashboard sidebar.
export default function DoctorShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const onboarding = pathname.startsWith('/doctor/register')

  return (
    <RoleGuard allow="doctor">
      {onboarding ? (
        children
      ) : (
        <>
          <NetworkBanner />
          <StatusAckNotice />
          <DoctorConsultationRecovery />
          <ResponsiveShell sidebar={<DoctorSidebar />}>
            <IncomingRequestOverlay />
            <AppointmentAlerts />
            {children}
          </ResponsiveShell>
        </>
      )}
    </RoleGuard>
  )
}

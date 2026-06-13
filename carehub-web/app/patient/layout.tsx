export const dynamic = 'force-dynamic'
import PatientSidebar from '@/components/patient/Sidebar'
import AppointmentAlerts from '@/components/ui/AppointmentAlerts'
import ResponsiveShell from '@/components/ui/ResponsiveShell'
import RoleGuard from '@/components/ui/RoleGuard'

export default function PatientLayout({ children }: { children: React.ReactNode }) {
  return (
    <RoleGuard allow="patient">
      <ResponsiveShell sidebar={<PatientSidebar />}>
        <AppointmentAlerts />
        {children}
      </ResponsiveShell>
    </RoleGuard>
  )
}

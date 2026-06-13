export const dynamic = 'force-dynamic'
import DoctorShell from '@/components/doctor/Shell'

export default function DoctorLayout({ children }: { children: React.ReactNode }) {
  return <DoctorShell>{children}</DoctorShell>
}

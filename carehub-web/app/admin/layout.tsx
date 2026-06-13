export const dynamic = 'force-dynamic'
import AdminSidebar from '@/components/admin/Sidebar'
import ResponsiveShell from '@/components/ui/ResponsiveShell'
import RoleGuard from '@/components/ui/RoleGuard'

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <RoleGuard allow="admin">
      <ResponsiveShell sidebar={<AdminSidebar />}>
        {children}
      </ResponsiveShell>
    </RoleGuard>
  )
}

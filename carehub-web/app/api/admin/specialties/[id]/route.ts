import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/server'
import { logAdminAction, getRequestContext } from '@/lib/supabase/audit'

async function requireAdmin() {
  const { userId } = await auth()
  if (!userId) return null
  const { data } = await supabaseAdmin.from('users').select('role').eq('clerk_id', userId).single()
  return data?.role === 'admin' ? userId : null
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const adminId = await requireAdmin()
  if (!adminId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  // Fetch name before deletion for the audit log
  const { data: specialty } = await supabaseAdmin
    .from('specialties')
    .select('name')
    .eq('id', params.id)
    .single()

  const { error } = await supabaseAdmin
    .from('specialties')
    .delete()
    .eq('id', params.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await logAdminAction(adminId, 'specialty_deleted', { name: specialty?.name, specialtyId: params.id }, { entityType: 'specialty', entityId: params.id, ...getRequestContext(req) })
  return NextResponse.json({ success: true })
}

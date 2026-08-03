import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/server'
import { logAdminAction, getRequestContext } from '@/lib/supabase/audit'

// PATCH /api/admin/patients/[id]
// body: { action: 'suspend' | 'unsuspend' }
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: caller } = await supabaseAdmin
    .from('users')
    .select('role')
    .eq('clerk_id', userId)
    .single()

  if (caller?.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json()
  const { action } = body as { action: 'suspend' | 'unsuspend' }
  const id = params.id

  if (action !== 'suspend' && action !== 'unsuspend') {
    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  }

  const isSuspended = action === 'suspend'

  const { error } = await supabaseAdmin
    .from('users')
    .update({ is_suspended: isSuspended })
    .eq('id', id)
    .eq('role', 'patient')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await supabaseAdmin.from('notifications').insert({
    user_id: id,
    title: isSuspended ? 'Account Suspended' : 'Account Reinstated',
    body: isSuspended
      ? 'Your Dawa account has been suspended. Please contact support for more information.'
      : 'Your Dawa account has been reinstated. You can now book consultations again.',
    type: isSuspended ? 'account_suspended' : 'account_reinstated',
    data_json: {},
  })

  await logAdminAction(userId, isSuspended ? 'suspend_patient' : 'unsuspend_patient', { patientUserId: id }, { entityType: 'patient', entityId: id, ...getRequestContext(req) })
  return NextResponse.json({ success: true, is_suspended: isSuspended })
}

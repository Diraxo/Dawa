import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/server'
import { logAdminAction } from '@/lib/supabase/audit'

// PATCH /api/admin/consultations/[id]
// body: { action: 'cancel' }
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
  const { action } = body as { action: 'cancel' }
  const id = params.id

  if (action !== 'cancel') {
    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  }

  // Fetch the consultation first to validate it can be cancelled and get participant IDs
  const { data: consultation, error: fetchError } = await supabaseAdmin
    .from('consultations')
    .select('id, status, patient_id, doctor_id, type')
    .eq('id', id)
    .single()

  if (fetchError || !consultation) {
    return NextResponse.json({ error: 'Consultation not found' }, { status: 404 })
  }

  if (consultation.status === 'completed' || consultation.status === 'cancelled') {
    return NextResponse.json(
      { error: `Cannot cancel a ${consultation.status} consultation` },
      { status: 400 }
    )
  }

  const { error } = await supabaseAdmin
    .from('consultations')
    .update({ status: 'cancelled' })
    .eq('id', id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Notify patient
  if (consultation.patient_id) {
    await supabaseAdmin.from('notifications').insert({
      user_id: consultation.patient_id,
      title: 'Consultation Cancelled',
      body: 'Your consultation has been cancelled by an administrator. Please contact support for assistance.',
      type: 'consultation_cancelled',
      data_json: { consultationId: id },
    })
  }

  // Notify doctor — doctor_id here is doctor_profiles.id, need user_id
  if (consultation.doctor_id) {
    const { data: profile } = await supabaseAdmin
      .from('doctor_profiles')
      .select('user_id')
      .eq('id', consultation.doctor_id)
      .single()

    if (profile?.user_id) {
      await supabaseAdmin.from('notifications').insert({
        user_id: profile.user_id,
        title: 'Consultation Cancelled',
        body: 'A consultation has been cancelled by an administrator.',
        type: 'consultation_cancelled',
        data_json: { consultationId: id },
      })
    }
  }

  await logAdminAction(userId, 'cancel_consultation', { consultationId: id, type: consultation.type })
  return NextResponse.json({ success: true })
}

// GET /api/admin/consultations/[id] — fetch consultation summary
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
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

  const { data, error } = await supabaseAdmin
    .from('consultation_summaries')
    .select('*')
    .eq('consultation_id', params.id)
    .single()

  if (error) return NextResponse.json({ summary: null })
  return NextResponse.json({ summary: data })
}

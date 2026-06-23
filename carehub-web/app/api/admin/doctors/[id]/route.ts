import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/server'
import { logAdminAction } from '@/lib/supabase/audit'

async function sendEmail(to: string, subject: string, body: string) {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) return
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'Dawa <noreply@dawa.health>',
      to,
      subject,
      text: body,
    }),
  })
}

// PATCH /api/admin/doctors/[id]
// body: { action: 'suspend' | 'reinstate' }
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
  const { action } = body as { action: 'suspend' | 'reinstate' }
  const id = params.id

  if (action !== 'suspend' && action !== 'reinstate') {
    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  }

  const newStatus = action === 'suspend' ? 'suspended' : 'approved'

  const { error } = await supabaseAdmin
    .from('doctor_profiles')
    .update({ status: newStatus })
    .eq('id', id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Fetch doctor's user info for notifications
  const { data: profile } = await supabaseAdmin
    .from('doctor_profiles')
    .select('user_id')
    .eq('id', id)
    .single()

  if (profile?.user_id) {
    const { data: userRow } = await supabaseAdmin
      .from('users')
      .select('email, full_name')
      .eq('id', profile.user_id)
      .single()

    const doctorName = userRow?.full_name ?? 'Doctor'

    if (action === 'suspend') {
      await supabaseAdmin.from('notifications').insert({
        user_id: profile.user_id,
        title: 'Account Suspended',
        body: 'Your Dawa doctor account has been suspended by an administrator. Please contact support for more information.',
        type: 'doctor_suspended',
        data_json: { doctorProfileId: id },
      })

      if (userRow?.email) {
        await sendEmail(
          userRow.email,
          'Your Dawa Account Has Been Suspended',
          `Hello Dr. ${doctorName},\n\nYour Dawa doctor account has been suspended by an administrator.\n\nIf you believe this is an error or would like to appeal this decision, please contact our support team.\n\nBest regards,\nThe Dawa Team`
        )
      }
    } else {
      await supabaseAdmin.from('notifications').insert({
        user_id: profile.user_id,
        title: 'Account Reinstated',
        body: 'Your Dawa doctor account has been reinstated. You can now go online and accept consultations again.',
        type: 'doctor_reinstated',
        data_json: { doctorProfileId: id },
      })

      if (userRow?.email) {
        await sendEmail(
          userRow.email,
          'Your Dawa Account Has Been Reinstated',
          `Hello Dr. ${doctorName},\n\nGreat news! Your Dawa doctor account has been reinstated.\n\nYou can now log in and start accepting patient consultations again.\n\nBest regards,\nThe Dawa Team`
        )
      }
    }
  }

  await logAdminAction(userId, action === 'suspend' ? 'suspend_doctor' : 'reinstate_doctor', { doctorProfileId: id })
  return NextResponse.json({ success: true, status: newStatus })
}

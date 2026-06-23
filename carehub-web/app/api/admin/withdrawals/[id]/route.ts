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

// PATCH /api/admin/withdrawals/[id]
// body: { action: 'approve' | 'reject' | 'paid' }
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
  const { action } = body as { action: 'approve' | 'reject' | 'paid' }
  const id = params.id

  if (!['approve', 'reject', 'paid'].includes(action)) {
    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  }

  const newStatus = action === 'approve' ? 'approved' : action === 'reject' ? 'rejected' : 'paid'

  const { error } = await supabaseAdmin
    .from('withdrawals')
    .update({ status: newStatus, processed_at: new Date().toISOString() })
    .eq('id', id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Fetch withdrawal + doctor info for notifications
  const { data: withdrawal } = await supabaseAdmin
    .from('withdrawals')
    .select('amount, doctor_id')
    .eq('id', id)
    .single()

  if (withdrawal?.doctor_id) {
    // doctor_id in withdrawals references doctor_profiles.id — join via user_id
    const { data: profile } = await supabaseAdmin
      .from('doctor_profiles')
      .select('user_id')
      .eq('id', withdrawal.doctor_id)
      .single()

    if (profile?.user_id) {
      const { data: userRow } = await supabaseAdmin
        .from('users')
        .select('email, full_name')
        .eq('id', profile.user_id)
        .single()

      const doctorName = userRow?.full_name ?? 'Doctor'
      const amount = `ETB ${withdrawal.amount}`

      if (action === 'approve') {
        await supabaseAdmin.from('notifications').insert({
          user_id: profile.user_id,
          title: 'Withdrawal Approved',
          body: `Your withdrawal request of ${amount} has been approved and is being processed.`,
          type: 'withdrawal_approved',
          data_json: { withdrawalId: id, amount: withdrawal.amount },
        })

        if (userRow?.email) {
          await sendEmail(
            userRow.email,
            'Your Withdrawal Request Has Been Approved',
            `Hello Dr. ${doctorName},\n\nYour withdrawal request of ${amount} has been approved and is being processed.\n\nYou will be notified once the transfer is complete.\n\nBest regards,\nThe Dawa Team`
          )
        }
      } else if (action === 'reject') {
        await supabaseAdmin.from('notifications').insert({
          user_id: profile.user_id,
          title: 'Withdrawal Not Processed',
          body: `Your withdrawal request of ${amount} could not be processed. Please contact support for details.`,
          type: 'withdrawal_rejected',
          data_json: { withdrawalId: id, amount: withdrawal.amount },
        })

        if (userRow?.email) {
          await sendEmail(
            userRow.email,
            'Update on Your Withdrawal Request',
            `Hello Dr. ${doctorName},\n\nUnfortunately, your withdrawal request of ${amount} could not be processed at this time.\n\nPlease contact our support team for more information.\n\nBest regards,\nThe Dawa Team`
          )
        }
      } else if (action === 'paid') {
        await supabaseAdmin.from('notifications').insert({
          user_id: profile.user_id,
          title: 'Payment Sent',
          body: `Your withdrawal of ${amount} has been sent to your bank account. Please check your balance.`,
          type: 'withdrawal_paid',
          data_json: { withdrawalId: id, amount: withdrawal.amount },
        })

        if (userRow?.email) {
          await sendEmail(
            userRow.email,
            'Your Withdrawal Has Been Paid',
            `Hello Dr. ${doctorName},\n\nYour withdrawal of ${amount} has been sent to your registered bank account.\n\nPlease allow 1-3 business days for the funds to appear.\n\nBest regards,\nThe Dawa Team`
          )
        }
      }
    }
  }

  await logAdminAction(userId, `withdrawal_${action}`, { withdrawalId: id, amount: withdrawal?.amount })
  return NextResponse.json({ success: true, status: newStatus })
}

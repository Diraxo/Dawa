import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/server'
import { logAdminAction, getRequestContext } from '@/lib/supabase/audit'
import { stripDrPrefix } from '@/lib/utils'
import { sendDoctorStatusPush } from '@/lib/doctorStatusPush'

async function getEmailTemplate(key: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from('platform_settings')
    .select('value')
    .eq('key', key)
    .single()
  return typeof data?.value === 'string' ? data.value : null
}

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
  const { action, reason } = body as { action: 'approve' | 'reject'; reason?: string }
  const id = params.id

  if (action === 'approve') {
    const { error } = await supabaseAdmin
      .from('doctor_profiles')
      .update({ status: 'approved', approved_at: new Date().toISOString() })
      .eq('id', id)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    const { data: profile } = await supabaseAdmin
      .from('doctor_profiles')
      .select('user_id')
      .eq('id', id)
      .single()

    if (profile?.user_id) {
      // In-app notification
      await supabaseAdmin.from('notifications').insert({
        user_id: profile.user_id,
        title: 'Doctor Application Approved',
        body: 'Your account has been approved. You may now begin accepting patients.',
        type: 'doctor_approved',
        data_json: { doctorProfileId: id },
      })
      await sendDoctorStatusPush(profile.user_id, 'Doctor Application Approved', 'Your account has been approved. You may now begin accepting patients.')

      // Email notification
      const { data: userRow } = await supabaseAdmin
        .from('users')
        .select('email, full_name')
        .eq('id', profile.user_id)
        .single()

      if (userRow?.email) {
        const template = await getEmailTemplate('email_approval_template')
        const doctorName = stripDrPrefix(userRow.full_name ?? 'Doctor')
        const emailBody = template
          ? template.replace(/\{name\}/g, doctorName)
          : `Hello Dr. ${doctorName},\n\nYour Dawa application has been approved! You can now log in and start accepting consultations.\n\nWelcome to the Dawa team!`
        await sendEmail(userRow.email, 'Your Dawa Application Has Been Approved 🎉', emailBody)
      }
    }

    await logAdminAction(userId, 'approve_doctor', { doctorProfileId: id }, { entityType: 'doctor_profile', entityId: id, ...getRequestContext(req) })
    return NextResponse.json({ success: true })
  }

  if (action === 'reject') {
    if (!reason?.trim()) {
      return NextResponse.json({ error: 'Rejection reason required' }, { status: 400 })
    }

    const { error } = await supabaseAdmin
      .from('doctor_profiles')
      .update({ status: 'rejected', rejection_reason: reason })
      .eq('id', id)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    const { data: profile } = await supabaseAdmin
      .from('doctor_profiles')
      .select('user_id')
      .eq('id', id)
      .single()

    if (profile?.user_id) {
      // In-app notification
      await supabaseAdmin.from('notifications').insert({
        user_id: profile.user_id,
        title: 'Doctor Application Rejected',
        body: `Your application was not approved. Reason: ${reason}`,
        type: 'doctor_rejected',
        data_json: { doctorProfileId: id },
      })
      await sendDoctorStatusPush(profile.user_id, 'Doctor Application Rejected', `Your application was not approved. Reason: ${reason}`)

      // Email notification
      const { data: userRow } = await supabaseAdmin
        .from('users')
        .select('email, full_name')
        .eq('id', profile.user_id)
        .single()

      if (userRow?.email) {
        const template = await getEmailTemplate('email_rejection_template')
        const doctorName = stripDrPrefix(userRow.full_name ?? 'Doctor')
        const emailBody = template
          ? template.replace(/\{name\}/g, doctorName).replace(/\{reason\}/g, reason)
          : `Hello Dr. ${doctorName},\n\nYour Dawa application was not approved at this time.\n\nReason: ${reason}\n\nIf you believe this is an error, please contact support.\n\nThe Dawa Team`
        await sendEmail(userRow.email, 'Update on Your Dawa Application', emailBody)
      }
    }

    await logAdminAction(userId, 'reject_doctor', { doctorProfileId: id, reason }, { entityType: 'doctor_profile', entityId: id, ...getRequestContext(req) })
    return NextResponse.json({ success: true })
  }

  return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
}

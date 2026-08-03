import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/server'
import { logAdminAction, getRequestContext } from '@/lib/supabase/audit'
import { stripDrPrefix } from '@/lib/utils'
import { sendDoctorStatusPush } from '@/lib/doctorStatusPush'
import { parseLicensePaths } from '@/lib/doctorDocuments'

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
  const { action } = body as {
    action: 'suspend' | 'reinstate' | 'enable_document_update' | 'disable_document_update' | 'approve_document_update' | 'reject_document_update'
  }
  const id = params.id

  const validActions = ['suspend', 'reinstate', 'enable_document_update', 'disable_document_update', 'approve_document_update', 'reject_document_update']
  if (!validActions.includes(action)) {
    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  }

  if (action === 'enable_document_update' || action === 'disable_document_update') {
    const { error } = await supabaseAdmin
      .from('doctor_profiles')
      .update({ documents_update_allowed: action === 'enable_document_update' })
      .eq('id', id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    await logAdminAction(userId, action, { doctorProfileId: id }, { entityType: 'doctor_profile', entityId: id, ...getRequestContext(req) })
    return NextResponse.json({ success: true, documentsUpdateAllowed: action === 'enable_document_update' })
  }

  if (action === 'approve_document_update' || action === 'reject_document_update') {
    const newReviewStatus = action === 'approve_document_update' ? 'approved' : 'rejected'

    const updatePayload: Record<string, unknown> = {
      document_review_status: newReviewStatus,
      document_reviewed_at: new Date().toISOString(),
    }

    // On rejection, drop the newly-submitted (still-unreviewed) file — it's
    // always the last entry, since my-documents.tsx only ever appends — and
    // delete it from storage rather than leaving a rejected doc retained
    // alongside the doctor's still-approved documents.
    let rejectedPath: string | null = null
    if (action === 'reject_document_update') {
      const { data: current } = await supabaseAdmin
        .from('doctor_profiles')
        .select('license_doc_url')
        .eq('id', id)
        .single()
      const paths = parseLicensePaths(current?.license_doc_url ?? null)
      if (paths.length > 0) {
        rejectedPath = paths[paths.length - 1]
        const remaining = paths.slice(0, -1)
        updatePayload.license_doc_url = remaining.length > 0 ? JSON.stringify(remaining) : null
      }
    }

    const { error } = await supabaseAdmin
      .from('doctor_profiles')
      .update(updatePayload)
      .eq('id', id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    if (rejectedPath) {
      await supabaseAdmin.storage.from('doctor-documents').remove([rejectedPath]).catch(() => {})
    }

    const { data: profile } = await supabaseAdmin
      .from('doctor_profiles')
      .select('user_id')
      .eq('id', id)
      .single()
    if (profile?.user_id) {
      const title = newReviewStatus === 'approved' ? 'Document Update Approved' : 'Document Update Rejected'
      const notifBody = newReviewStatus === 'approved'
        ? 'Your updated documents have been reviewed and approved.'
        : 'Your updated documents were reviewed and rejected. Please contact support for details.'
      await supabaseAdmin.from('notifications').insert({
        user_id: profile.user_id,
        title,
        body: notifBody,
        type: 'document_update_reviewed',
        data_json: { doctorProfileId: id, screen: 'documents' },
      })
      await sendDoctorStatusPush(profile.user_id, title, notifBody, { screen: 'documents' })
    }

    await logAdminAction(userId, action, { doctorProfileId: id }, { entityType: 'doctor_profile', entityId: id, ...getRequestContext(req) })
    return NextResponse.json({ success: true, documentReviewStatus: newReviewStatus })
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

    const doctorName = stripDrPrefix(userRow?.full_name ?? 'Doctor')

    if (action === 'suspend') {
      await supabaseAdmin.from('notifications').insert({
        user_id: profile.user_id,
        title: 'Account Suspended',
        body: 'Your account has been suspended. Please contact support.',
        type: 'doctor_suspended',
        data_json: { doctorProfileId: id, screen: 'profile' },
      })
      await sendDoctorStatusPush(profile.user_id, 'Account Suspended', 'Your account has been suspended. Please contact support.', { screen: 'profile' })

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
        data_json: { doctorProfileId: id, screen: 'profile' },
      })
      await sendDoctorStatusPush(profile.user_id, 'Account Reinstated', 'Your Dawa doctor account has been reinstated. You can now go online and accept consultations again.', { screen: 'profile' })

      if (userRow?.email) {
        await sendEmail(
          userRow.email,
          'Your Dawa Account Has Been Reinstated',
          `Hello Dr. ${doctorName},\n\nGreat news! Your Dawa doctor account has been reinstated.\n\nYou can now log in and start accepting patient consultations again.\n\nBest regards,\nThe Dawa Team`
        )
      }
    }
  }

  await logAdminAction(userId, action === 'suspend' ? 'suspend_doctor' : 'reinstate_doctor', { doctorProfileId: id }, { entityType: 'doctor_profile', entityId: id, ...getRequestContext(req) })
  return NextResponse.json({ success: true, status: newStatus })
}

import type { SupabaseClient } from '@supabase/supabase-js'
import { ghostDebug } from '@/lib/logger'

export type Role = 'patient' | 'doctor'

export const PATIENT_ROUTE_MAP: Record<string, string> = {
  chat:  '/(patient)/chat-consultation',
  phone: '/(patient)/phone-consultation',
  video: '/(patient)/video-consultation',
}
export const DOCTOR_ROUTE_MAP: Record<string, string> = {
  chat:  '/(doctor)/chat-consultation',
  phone: '/(doctor)/phone-consultation',
  video: '/(doctor)/video-consultation',
}

// Statuses that mean "this user must never lose track of this consultation" —
// on relaunch/resume/cold-launch they get routed straight back in, never to
// Home/tabs.
export const ACTIVE_STATUSES = ['waiting_for_doctor', 'accepted', 'in_progress', 'active']

export interface ResolvedConsultationRoute {
  pathname: string
  params: Record<string, string | undefined>
  /** Raw consultation id/status, for callers that want to dedupe repeated redirects. */
  consultationId: string
  status: string
}

/**
 * Looks up whether this user (by their `users.id` row) currently has an
 * active consultation, and if so, resolves the exact screen/params they
 * should land on. Shared by the splash-screen cold-launch gate (so Home
 * never mounts first) and useActiveConsultationRecovery (foreground/resume/
 * navigation checks after the app is already up).
 */
export async function resolveActiveConsultationRoute(
  client: SupabaseClient,
  role: Role,
  userRowId: string,
): Promise<ResolvedConsultationRoute | null> {
  let query = client
    .from('consultations')
    .select(`
      id, type, status, started_at,
      doctor:doctor_profiles!doctor_id(id, user:users(full_name, profile_photo_url)),
      patient:users!patient_id(id, full_name, profile_photo_url)
    `)
    .in('status', ACTIVE_STATUSES)
    .order('created_at', { ascending: false })
    .limit(1)

  if (role === 'patient') {
    query = query.eq('patient_id', userRowId)
  } else {
    const { data: dp } = await client
      .from('doctor_profiles')
      .select('id')
      .eq('user_id', userRowId)
      .maybeSingle()
    if (!dp) return null
    query = query.eq('doctor_id', dp.id)
  }

  const { data } = await query.maybeSingle()
  ghostDebug('[active-consultation-restoration] resolveActiveConsultationRoute', {
    role, userRowId, foundConsultationId: (data as any)?.id ?? null, status: (data as any)?.status ?? null,
  })
  if (!data) return null

  const resumeElapsed = data.started_at
    ? String(Math.max(0, Math.floor((Date.now() - new Date(data.started_at).getTime()) / 1000)))
    : undefined

  if (role === 'patient') {
    const doctorInfo     = (data as any).doctor
    const doctorId       = doctorInfo?.id
    const doctorName     = doctorInfo?.user?.full_name ?? 'Doctor'
    const doctorPhotoUrl = doctorInfo?.user?.profile_photo_url ?? undefined

    if (data.status === 'waiting_for_doctor') {
      return {
        pathname: '/(patient)/waiting-room',
        params: { consultationId: data.id, doctorId, doctorName, doctorPhotoUrl, consultationType: data.type },
        consultationId: data.id,
        status: data.status,
      }
    }
    return {
      pathname: PATIENT_ROUTE_MAP[data.type ?? 'chat'] ?? PATIENT_ROUTE_MAP.chat,
      params: {
        channelId: data.id, consultationId: data.id, doctorId, doctorName, doctorPhotoUrl,
        ...(resumeElapsed ? { resumeElapsed } : {}),
      },
      consultationId: data.id,
      status: data.status,
    }
  }

  const patientInfo     = (data as any).patient
  const patientId       = patientInfo?.id
  const patientName     = patientInfo?.full_name ?? 'Patient'
  const patientPhotoUrl = patientInfo?.profile_photo_url ?? undefined

  if (data.status === 'waiting_for_doctor') {
    return {
      pathname: '/(doctor)/incoming-request',
      params: { consultationId: data.id, patientId, patientName, patientPhotoUrl, consultationType: data.type },
      consultationId: data.id,
      status: data.status,
    }
  }
  return {
    pathname: DOCTOR_ROUTE_MAP[data.type ?? 'chat'] ?? DOCTOR_ROUTE_MAP.chat,
    params: {
      channelId: data.id, consultationId: data.id, patientId, patientName, patientPhotoUrl,
      ...(resumeElapsed ? { resumeElapsed } : {}),
    },
    consultationId: data.id,
    status: data.status,
  }
}

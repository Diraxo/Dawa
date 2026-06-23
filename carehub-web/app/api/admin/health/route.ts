import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function GET() {
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

  // Ping Supabase with a real query
  let supabaseOk = false
  try {
    const { error } = await supabaseAdmin
      .from('users')
      .select('id', { count: 'exact', head: true })
    supabaseOk = !error
  } catch {
    supabaseOk = false
  }

  const env = process.env

  return NextResponse.json({
    services: [
      {
        label: 'Database (Supabase)',
        status: supabaseOk ? 'Operational' : 'Degraded',
        ok: supabaseOk,
      },
      {
        label: 'Authentication (Clerk)',
        status: env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ? 'Configured' : 'Not Configured',
        ok: !!env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
      },
      {
        label: 'Video / Voice Calls (Agora)',
        status: env.NEXT_PUBLIC_AGORA_APP_ID ? 'Configured' : 'Not Configured',
        ok: !!env.NEXT_PUBLIC_AGORA_APP_ID,
      },
      {
        label: 'Chat (Stream)',
        status: env.NEXT_PUBLIC_STREAM_API_KEY ? 'Configured' : 'Not Configured',
        ok: !!env.NEXT_PUBLIC_STREAM_API_KEY,
      },
      {
        label: 'Push Notifications (FCM)',
        status: env.FIREBASE_PROJECT_ID ? 'Configured' : 'Not Configured',
        ok: !!env.FIREBASE_PROJECT_ID,
      },
      {
        label: 'Email (Resend)',
        status: env.RESEND_API_KEY ? 'Configured' : 'Not Configured',
        ok: !!env.RESEND_API_KEY,
      },
    ],
  })
}

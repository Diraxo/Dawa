import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/server'

// Upserts a browser's Web Push subscription for the signed-in user so
// send-appointment-notification / handle-consultation-notification can push
// to it even while the tab/browser is fully closed. See
// carehub-web/lib/hooks/useWebPushSubscription.ts (the caller) and
// supabase/migrations/076_web_push_subscriptions.sql.
export async function POST(request: Request) {
  const { userId } = await auth()
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let endpoint: string
  let p256dh: string
  let authKey: string
  try {
    const body = await request.json()
    endpoint = body.endpoint
    p256dh = body.keys?.p256dh
    authKey = body.keys?.auth
    if (!endpoint || !p256dh || !authKey) throw new Error('invalid')
  } catch {
    return NextResponse.json({ error: 'endpoint and keys.{p256dh,auth} are required' }, { status: 400 })
  }

  const { data: user } = await supabaseAdmin.from('users').select('id').eq('clerk_id', userId).single()
  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 })
  }

  const { error } = await supabaseAdmin
    .from('web_push_subscriptions')
    .upsert({ user_id: user.id, endpoint, p256dh, auth: authKey }, { onConflict: 'endpoint' })

  if (error) {
    return NextResponse.json({ error: 'Failed to save subscription' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}

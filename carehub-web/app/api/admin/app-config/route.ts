import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/server'
import { logAdminAction } from '@/lib/supabase/audit'

export async function PATCH(req: NextRequest) {
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
  const { platform, min_required_version, latest_version, update_message, store_url } = body as {
    platform: 'android' | 'ios'
    min_required_version: string
    latest_version: string
    update_message: string
    store_url: string
  }

  if (!['android', 'ios'].includes(platform)) {
    return NextResponse.json({ error: 'Invalid platform' }, { status: 400 })
  }

  const { error } = await supabaseAdmin
    .from('app_config')
    .upsert({
      platform,
      min_required_version,
      latest_version,
      update_message,
      store_url,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'platform' })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await logAdminAction(userId, 'update_app_config', { platform, latest_version, min_required_version })
  return NextResponse.json({ success: true })
}

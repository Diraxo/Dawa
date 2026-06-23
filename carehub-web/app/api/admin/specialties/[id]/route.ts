import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/server'

async function requireAdmin() {
  const { userId } = auth()
  if (!userId) return null
  const { data } = await supabaseAdmin.from('users').select('role').eq('clerk_id', userId).single()
  return data?.role === 'admin' ? userId : null
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const adminId = await requireAdmin()
  if (!adminId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { error } = await supabaseAdmin
    .from('specialties')
    .delete()
    .eq('id', params.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}

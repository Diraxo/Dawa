import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/server'

async function requireAdmin() {
  const { userId } = auth()
  if (!userId) return null
  const { data } = await supabaseAdmin.from('users').select('role').eq('clerk_id', userId).single()
  return data?.role === 'admin' ? userId : null
}

export async function GET() {
  const adminId = await requireAdmin()
  if (!adminId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { data, error } = await supabaseAdmin
    .from('specialties')
    .select('id, name, created_at')
    .order('name', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function POST(req: NextRequest) {
  const adminId = await requireAdmin()
  if (!adminId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { name } = await req.json()
  if (!name?.trim()) return NextResponse.json({ error: 'Name is required' }, { status: 400 })

  const { data, error } = await supabaseAdmin
    .from('specialties')
    .insert({ name: name.trim() })
    .select()
    .single()

  if (error) {
    const msg = error.message.includes('unique') ? 'That specialty already exists.' : error.message
    return NextResponse.json({ error: msg }, { status: 400 })
  }
  return NextResponse.json(data, { status: 201 })
}

import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

async function requireAdmin(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) return null
  const { data } = await supabaseAdmin
    .from('users')
    .select('role')
    .eq('clerk_id', userId)
    .single()
  return data?.role === 'admin' ? userId : null
}

export async function GET(req: NextRequest) {
  const adminId = await requireAdmin(req)
  if (!adminId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: adminId === null ? 401 : 403 })
  }

  const url    = new URL(req.url)
  const page   = Math.max(0, parseInt(url.searchParams.get('page')  ?? '0', 10))
  const limit  = Math.min(500, Math.max(1, parseInt(url.searchParams.get('limit') ?? '50', 10)))
  const offset = page * limit
  const search = url.searchParams.get('search')?.trim() ?? ''
  const action = url.searchParams.get('action')?.trim() ?? ''
  const from   = url.searchParams.get('from')?.trim() ?? ''
  const to     = url.searchParams.get('to')?.trim() ?? ''
  const csv    = url.searchParams.get('export') === 'csv'

  // Query audit_logs (new comprehensive table).
  // Fall back to admin_logs join if audit_logs is empty (legacy period).
  let query = supabaseAdmin
    .from('audit_logs')
    .select(`
      id,
      action,
      actor_role,
      entity_type,
      entity_id,
      ip_address,
      metadata,
      timestamp,
      actor:users!actor_id(full_name, email)
    `, { count: 'exact' })
    .order('timestamp', { ascending: false })

  if (action) {
    query = query.eq('action', action)
  }
  if (from) {
    query = query.gte('timestamp', `${from}T00:00:00.000Z`)
  }
  if (to) {
    query = query.lte('timestamp', `${to}T23:59:59.999Z`)
  }
  if (search) {
    // Full-text search across action, entity_type, entity_id, and metadata
    query = query.or(
      `action.ilike.%${search}%,entity_type.ilike.%${search}%,entity_id.ilike.%${search}%`
    )
  }

  if (!csv) {
    query = query.range(offset, offset + limit - 1)
  }

  const { data, count, error } = await query

  // If audit_logs is empty, fall back to legacy admin_logs
  if ((!data || data.length === 0) && !error && !search && !action && !from && !to) {
    return legacyFallback(req, page, limit, offset, csv)
  }

  if (error) {
    // Graceful fallback to admin_logs
    return legacyFallback(req, page, limit, offset, csv)
  }

  if (csv) {
    const csvText = buildCsv(data ?? [])
    return new Response(csvText, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="audit-log.csv"`,
        'Cache-Control': 'no-store',
      },
    })
  }

  return NextResponse.json({ entries: data ?? [], total: count ?? 0 })
}

/** Fallback to the legacy admin_logs table (pre-025 records). */
async function legacyFallback(
  _req: NextRequest,
  page: number,
  limit: number,
  offset: number,
  csv: boolean,
) {
  const { data, count, error } = await supabaseAdmin
    .from('admin_logs')
    .select(`
      id,
      action,
      metadata,
      created_at,
      admin:users!admin_id(full_name, email)
    `, { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (error) return NextResponse.json({ entries: [], total: 0 })

  // Normalise to the audit_logs shape so the UI works the same way
  const normalised = (data ?? []).map((e: any) => ({
    id:          e.id,
    action:      e.action,
    actor_role:  'admin',
    entity_type: null,
    entity_id:   null,
    ip_address:  null,
    metadata:    e.metadata,
    timestamp:   e.created_at,
    actor:       e.admin,
  }))

  if (csv) {
    return new Response(buildCsv(normalised), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="audit-log.csv"`,
        'Cache-Control': 'no-store',
      },
    })
  }

  return NextResponse.json({ entries: normalised, total: count ?? 0 })
}

function buildCsv(entries: any[]): string {
  const headers = ['timestamp', 'actor', 'role', 'action', 'entity_type', 'entity_id', 'ip_address', 'details']
  const rows = entries.map(e => [
    e.timestamp ?? '',
    e.actor?.full_name ?? e.actor?.email ?? 'System',
    e.actor_role ?? '',
    e.action ?? '',
    e.entity_type ?? '',
    e.entity_id ?? '',
    e.ip_address ?? '',
    e.metadata ? JSON.stringify(e.metadata).replace(/"/g, '""') : '',
  ].map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))

  return [headers.join(','), ...rows].join('\r\n')
}

import { supabaseAdmin } from './server'

export interface AuditContext {
  entityType?: string
  entityId?: string
  oldValue?: Record<string, unknown>
  newValue?: Record<string, unknown>
  ip?: string
  userAgent?: string
  metadata?: Record<string, unknown>
}

/**
 * Log an administrative or sensitive action.
 * Writes to both audit_logs (comprehensive) and the legacy admin_logs table.
 * Never throws — audit failure must not block the calling action.
 */
export async function logAdminAction(
  adminClerkId: string,
  action: string,
  metadata?: Record<string, unknown>,
  ctx?: AuditContext,
): Promise<void> {
  try {
    const { data: adminUser } = await supabaseAdmin
      .from('users')
      .select('id, role')
      .eq('clerk_id', adminClerkId)
      .single()

    // Write to comprehensive audit_logs
    await supabaseAdmin.from('audit_logs').insert({
      actor_clerk_id: adminClerkId,
      actor_id:       adminUser?.id ?? null,
      actor_role:     adminUser?.role ?? 'admin',
      action,
      entity_type:    ctx?.entityType ?? null,
      entity_id:      ctx?.entityId   ?? null,
      old_value:      ctx?.oldValue   ?? null,
      new_value:      ctx?.newValue   ?? null,
      ip_address:     ctx?.ip         ?? null,
      user_agent:     ctx?.userAgent  ?? null,
      metadata:       { ...(metadata ?? {}), ...(ctx?.metadata ?? {}) },
    })

    // Also write to legacy admin_logs for backward-compat with the existing audit page
    await supabaseAdmin.from('admin_logs').insert({
      admin_id: adminUser?.id ?? null,
      action,
      metadata: metadata ?? null,
    })
  } catch {
    // Audit failure is non-fatal — never block the main action
  }
}

/**
 * Log a non-admin system action (e.g. consultation auto-completed, payment webhook).
 */
export async function logSystemAction(
  action: string,
  ctx?: AuditContext,
): Promise<void> {
  try {
    await supabaseAdmin.from('audit_logs').insert({
      actor_clerk_id: null,
      actor_id:       null,
      actor_role:     'system',
      action,
      entity_type:    ctx?.entityType ?? null,
      entity_id:      ctx?.entityId   ?? null,
      old_value:      ctx?.oldValue   ?? null,
      new_value:      ctx?.newValue   ?? null,
      ip_address:     ctx?.ip         ?? null,
      user_agent:     ctx?.userAgent  ?? null,
      metadata:       ctx?.metadata   ?? null,
    })
  } catch {
    // Non-fatal
  }
}

/** Extract IP + user-agent from a Next.js Request object. */
export function getRequestContext(req: Request): Pick<AuditContext, 'ip' | 'userAgent'> {
  return {
    ip: req.headers.get('x-forwarded-for') ?? req.headers.get('x-real-ip') ?? undefined,
    userAgent: req.headers.get('user-agent') ?? undefined,
  }
}

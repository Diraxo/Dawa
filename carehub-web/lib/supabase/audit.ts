import { supabaseAdmin } from './server'

export async function logAdminAction(
  adminClerkId: string,
  action: string,
  metadata?: Record<string, unknown>,
) {
  try {
    const { data: adminUser } = await supabaseAdmin
      .from('users')
      .select('id')
      .eq('clerk_id', adminClerkId)
      .single()

    await supabaseAdmin.from('admin_logs').insert({
      admin_id: adminUser?.id ?? null,
      action,
      metadata: metadata ?? null,
    })
  } catch {
    // Audit failure is non-fatal — never block the main action
  }
}

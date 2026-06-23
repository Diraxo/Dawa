import { supabaseAdmin } from '@/lib/supabase/server';

type SecurityEvent =
  | 'login_failed'
  | 'login_success'
  | 'account_locked'
  | 'unauthorized_access'
  | 'suspicious_activity'
  | 'admin_login'
  | 'doctor_approved'
  | 'doctor_rejected';

interface SecurityEventDetails {
  userId?: string;
  email?: string;
  ip?: string;
  userAgent?: string;
  extra?: Record<string, unknown>;
}

const CRITICAL_EVENTS: SecurityEvent[] = [
  'account_locked',
  'unauthorized_access',
  'suspicious_activity',
];

export const logSecurityEvent = async (
  event: SecurityEvent,
  details: SecurityEventDetails
): Promise<void> => {
  try {
    await supabaseAdmin.from('security_logs').insert({
      event,
      user_id: details.userId ?? null,
      email: details.email ?? null,
      ip_address: details.ip ?? null,
      user_agent: details.userAgent ?? null,
      extra: details.extra ?? null,
      created_at: new Date().toISOString(),
    });

    if (CRITICAL_EVENTS.includes(event)) {
      // Fire-and-forget admin alert — never let this block the main response
      fetch('/api/alerts/security', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event, details }),
      }).catch(() => {});
    }
  } catch {
    // Security logging must never crash the main request flow
  }
};

export const getClientInfo = (request: Request) => ({
  ip:
    request.headers.get('x-forwarded-for') ??
    request.headers.get('x-real-ip') ??
    'unknown',
  userAgent: request.headers.get('user-agent') ?? 'unknown',
});

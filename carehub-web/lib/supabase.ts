import { createClient } from '@supabase/supabase-js'
import { createBrowserClient } from '@supabase/ssr'
import type { Database } from '@/types/database'

const url  = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

declare global {
  interface Window {
    Clerk?: { session?: { getToken: () => Promise<string | null> } }
  }
}

// Single GoTrueClient used for email+password auth (session stored in cookies).
// All other clients below do NOT create their own GoTrueClient — they either
// have persistSession:false or inject tokens via global headers — so this is
// the only instance that uses browser storage, eliminating the
// "Multiple GoTrueClient instances" warning.
export const supabaseEmailAuth = createBrowserClient<Database>(url, anon)

// Unified read/write client for all database queries.
// Clerk users get their JWT via window.Clerk; email+password users fall back
// to the session managed by supabaseEmailAuth above.
// persistSession:false means no second GoTrueClient storage entry is created.
export const supabase = createClient<Database>(url, anon, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  accessToken: async () => {
    if (typeof window === 'undefined') return null
    const clerkToken = await window.Clerk?.session?.getToken()
    if (clerkToken) return clerkToken
    // Fall back to the cookie session from supabaseEmailAuth
    const { data: { session } } = await supabaseEmailAuth.auth.getSession()
    return session?.access_token ?? null
  },
})

// Cache: one client per Clerk token — evict entries after 5 minutes to prevent stale tokens.
const TOKEN_TTL_MS = 5 * 60 * 1000
const _authClientCache = new Map<string, { client: ReturnType<typeof createClient<Database>>; ts: number }>()

// Explicit-token client for places that already hold a Clerk JWT
// (obtained via useAuth().getToken()).
export function getAuthClient(clerkToken: string) {
  const entry = _authClientCache.get(clerkToken)
  if (entry && Date.now() - entry.ts < TOKEN_TTL_MS) {
    return entry.client
  }
  const client = createClient<Database>(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${clerkToken}` } },
  })
  _authClientCache.set(clerkToken, { client, ts: Date.now() })
  // Evict stale entries periodically
  if (_authClientCache.size > 50) {
    const now = Date.now()
    for (const [key, val] of _authClientCache) {
      if (now - val.ts >= TOKEN_TTL_MS) _authClientCache.delete(key)
    }
  }
  return client
}

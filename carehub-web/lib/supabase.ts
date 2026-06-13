import { createClient } from '@supabase/supabase-js'
import { createBrowserClient } from '@supabase/ssr'

const url  = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

declare global {
  interface Window {
    Clerk?: { session?: { getToken: () => Promise<string | null> } }
  }
}

// Supabase Auth client for email+password users.
// Uses createBrowserClient (@supabase/ssr) so the session is stored in cookies,
// making it readable from the Next.js middleware for route protection.
// Must be declared before `supabase` so the fallback below can reference it.
export const supabaseEmailAuth = createBrowserClient(url, anon)

// Unified client for all database queries throughout the app.
// - Clerk OAuth users (Google/Facebook): uses Clerk JWT from window.Clerk.
// - Email+password users: falls back to the Supabase Auth JWT from the cookie session.
// RLS works for both because both JWTs carry a `sub` claim stored as `clerk_id`.
export const supabase = createClient(url, anon, {
  accessToken: async () => {
    if (typeof window === 'undefined') return null
    const clerkToken = await window.Clerk?.session?.getToken()
    if (clerkToken) return clerkToken
    const { data: { session } } = await supabaseEmailAuth.auth.getSession()
    return session?.access_token ?? null
  },
})

// Explicit-token client for places that already hold a Clerk JWT
// (obtained via useAuth().getToken()).
export function getAuthClient(clerkToken: string) {
  return createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${clerkToken}` } },
  })
}

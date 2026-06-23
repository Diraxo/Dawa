import AsyncStorage from '@react-native-async-storage/async-storage'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? ''
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? ''

// Supabase-native auth client — used for email+password sign-up and sign-in.
// Persists sessions in AsyncStorage so users stay logged in across restarts.
// Must be declared before `supabase` so the fallback below can reference it.
export const supabaseEmailAuth = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
})

// Set by useClerkTokenSync() in AppInitializer as soon as Clerk is ready.
// Clerk.session is not reliably accessible outside a ClerkProvider on web,
// so we inject getToken() via this ref instead of importing it at module level.
type TokenGetter = () => Promise<string | null>
let _clerkTokenGetter: TokenGetter | null = null

export function setClerkTokenGetter(fn: TokenGetter | null) {
  _clerkTokenGetter = fn
}

// Unified client for all database queries throughout the app.
// - Clerk users (email OTP / Google / Facebook): Clerk JWT via _clerkTokenGetter.
// - Email+password (Supabase-native) users: falls back to the persisted Supabase Auth JWT.
// RLS works for both because both JWTs carry a `sub` claim stored as `clerk_id`.
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  accessToken: async () => {
    if (_clerkTokenGetter) {
      const token = await _clerkTokenGetter()
      if (token) return token
    }
    const { data: { session } } = await supabaseEmailAuth.auth.getSession()
    return session?.access_token ?? null
  },
})

const TOKEN_TTL_MS = 5 * 60 * 1000
const _authClientCache = new Map<string, { client: ReturnType<typeof createClient>; ts: number }>()

export function getAuthClient(clerkToken: string) {
  const entry = _authClientCache.get(clerkToken)
  if (entry && Date.now() - entry.ts < TOKEN_TTL_MS) return entry.client
  const client = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${clerkToken}` } },
  })
  _authClientCache.set(clerkToken, { client, ts: Date.now() })
  if (_authClientCache.size > 20) {
    const now = Date.now()
    for (const [key, val] of _authClientCache) {
      if (now - val.ts >= TOKEN_TTL_MS) _authClientCache.delete(key)
    }
  }
  return client
}

const ALLOWED_FILE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10 MB

export function validateFile(file: { type: string; size: number; name?: string }): true {
  if (!ALLOWED_FILE_TYPES.includes(file.type)) {
    throw new Error('Invalid file type. Only JPG, PNG, WebP, and PDF are allowed.')
  }
  if (file.size > MAX_FILE_SIZE) {
    throw new Error('File too large. Maximum size is 10 MB.')
  }
  return true
}

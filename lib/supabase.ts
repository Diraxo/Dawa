import AsyncStorage from '@react-native-async-storage/async-storage'
import { getClerkInstance } from '@clerk/clerk-expo'
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

// Unified client for all database queries throughout the app.
// - Clerk OAuth users (Google/Facebook): uses Clerk JWT as bearer token.
// - Email+password users: falls back to the persisted Supabase Auth JWT.
// RLS works for both because both JWTs carry a `sub` claim stored as `clerk_id`.
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  accessToken: async () => {
    const clerkToken = await getClerkInstance().session?.getToken()
    if (clerkToken) return clerkToken
    const { data: { session } } = await supabaseEmailAuth.auth.getSession()
    return session?.access_token ?? null
  },
})

export function getAuthClient(clerkToken: string) {
  return createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${clerkToken}` } },
  })
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

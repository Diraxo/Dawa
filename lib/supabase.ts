import AsyncStorage from '@react-native-async-storage/async-storage'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

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
const _authClientCache = new Map<string, { client: SupabaseClient; ts: number }>()

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

// Supabase Storage's own JWT verification does not honor third-party
// (Clerk) RS256 tokens the way the Data API does — auth.jwt()->>'sub' comes
// back unpopulated inside Storage's RLS check, so an authenticated client's
// direct storage.upload()/remove() always fails with "new row violates row
// level security policy" even though the identical token authenticates every
// DB query fine (matches the open, unresolved supabase/supabase#34948).
// Route profile-photo writes through the upload-profile-photo edge function
// instead, which verifies the Clerk token itself (same jose/JWKS pattern as
// agora-token, apply-credit, etc.) and writes with the service-role key.
export async function uploadProfilePhoto(
  clerkToken: string,
  buffer: ArrayBuffer,
  mimeType: 'image/jpeg' | 'image/png',
  baseName: 'avatar' | 'profile' = 'avatar'
): Promise<string> {
  const res = await fetch(`${supabaseUrl}/functions/v1/upload-profile-photo?name=${baseName}`, {
    method: 'POST',
    headers: {
      'Content-Type': mimeType,
      Authorization: `Bearer ${clerkToken}`,
      apikey: supabaseAnonKey,
    },
    body: buffer,
  })
  if (!res.ok) {
    const body = await res.json().catch(() => null)
    throw new Error(body?.error ?? `Photo upload failed (${res.status})`)
  }
  const { url } = await res.json()
  return url as string
}

export async function deleteProfilePhotos(clerkToken: string): Promise<void> {
  const res = await fetch(`${supabaseUrl}/functions/v1/upload-profile-photo`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${clerkToken}`, apikey: supabaseAnonKey },
  })
  if (!res.ok) {
    const body = await res.json().catch(() => null)
    throw new Error(body?.error ?? `Photo delete failed (${res.status})`)
  }
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

// Chat attachments additionally allow Word documents (the attach sheet's own
// copy has always advertised "PDF, Word, or any file") — but unlike the old
// `type: '*/*'` document picker, nothing here falls through to "any file".
// Any file type (executables, scripts, archives) was previously acceptable
// through a consultation chat with no allowlist or size cap at all (P3-14).
const CHAT_ALLOWED_FILE_TYPES = [
  'image/jpeg', 'image/png', 'image/webp',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]
const MAX_CHAT_FILE_SIZE = 10 * 1024 * 1024 // 10 MB

export function validateChatAttachment(file: { type: string; size: number; name?: string }): true {
  if (!CHAT_ALLOWED_FILE_TYPES.includes(file.type)) {
    throw new Error('Unsupported file type. Only images, PDF, and Word documents are allowed.')
  }
  if (file.size > MAX_CHAT_FILE_SIZE) {
    throw new Error('File too large. Maximum size is 10 MB.')
  }
  return true
}

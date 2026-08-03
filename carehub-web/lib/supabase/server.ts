import { createClient } from '@supabase/supabase-js';

// Service role client — bypasses RLS entirely.
// ONLY import this in API routes and server actions.
// NEVER import in client components or 'use client' files.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const supabaseAdmin = createClient<any>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  }
);

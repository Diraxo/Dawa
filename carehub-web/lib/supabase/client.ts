import { createBrowserClient } from '@supabase/ssr';

// Anon key + RLS = users can only access their own data.
// Safe to use in client components and 'use client' files.
export const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

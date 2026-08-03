// Supabase Edge Function — handle-refund
// Refunds are DISABLED in V1. This function is a no-op stub kept for future use.
// The database trigger that called this has also been dropped (migration 018).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  // Refunds are disabled in V1 — do nothing.
  return new Response(
    JSON.stringify({ skipped: true, reason: 'refunds_disabled_v1' }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  )
})

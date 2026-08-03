// Public variables — safe to expose to the browser
export const publicEnv = {
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL!,
  supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  clerkPublishableKey: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY!,
  streamApiKey: process.env.NEXT_PUBLIC_STREAM_API_KEY!,
  agoraAppId: process.env.NEXT_PUBLIC_AGORA_APP_ID!,
};

// Server-only variables — NEVER import this file in client components or 'use client' files
export const serverEnv = {
  clerkSecretKey: process.env.CLERK_SECRET_KEY!,
  supabaseServiceRole: process.env.SUPABASE_SERVICE_ROLE_KEY!,
  agoraCertificate: process.env.AGORA_APP_CERTIFICATE!,
  streamApiSecret: process.env.STREAM_API_SECRET!,
  resendApiKey: process.env.RESEND_API_KEY!,
};

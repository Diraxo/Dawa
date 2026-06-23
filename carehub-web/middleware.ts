import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server'
import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

const isPublic = createRouteMatcher([
  '/',
  '/sign-in(.*)',
  '/sign-up(.*)',
  '/verify(.*)',
  '/role(.*)',
  '/forgot-password(.*)',
  '/reset-password(.*)',
  '/sso-callback(.*)',
  '/api/webhooks(.*)',
])

const isPatientRoute = createRouteMatcher(['/patient(.*)'])
const isDoctorRoute  = createRouteMatcher(['/doctor(.*)'])
const isAdminRoute   = createRouteMatcher(['/admin(.*)'])

const HOME: Record<string, string> = {
  patient: '/patient',
  doctor:  '/doctor',
  admin:   '/admin',
}

export default clerkMiddleware(async (auth, req) => {
  if (isPublic(req)) return NextResponse.next()

  const { userId } = auth()
  let clerkId: string | null = userId

  const res = NextResponse.next()

  if (!clerkId) {
    // No Clerk session — check for a Supabase Auth session (email+password users).
    const supabaseServer = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll: () => req.cookies.getAll(),
          setAll: (cookiesToSet) => {
            cookiesToSet.forEach(({ name, value, options }) =>
              res.cookies.set(name, value, options)
            )
          },
        },
      }
    )
    const { data: { session } } = await supabaseServer.auth.getSession()
    if (!session) {
      return NextResponse.redirect(new URL('/sign-in', req.url))
    }
    clerkId = session.user.id
  } else {
    auth().protect()
  }

  // Server-side role enforcement for role-specific route groups.
  // Uses service role to bypass RLS — this is safe because it runs only on the server.
  if (isPatientRoute(req) || isDoctorRoute(req) || isAdminRoute(req)) {
    try {
      const adminClient = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
        { auth: { persistSession: false } }
      )
      const { data: userRow } = await adminClient
        .from('users')
        .select('role')
        .eq('clerk_id', clerkId)
        .maybeSingle()

      const role = userRow?.role as string | undefined

      if (!role) {
        return NextResponse.redirect(new URL('/role', req.url))
      }

      if (isPatientRoute(req) && role !== 'patient') {
        return NextResponse.redirect(new URL(HOME[role] ?? '/role', req.url))
      }
      if (isDoctorRoute(req) && role !== 'doctor') {
        return NextResponse.redirect(new URL(HOME[role] ?? '/role', req.url))
      }
      if (isAdminRoute(req) && role !== 'admin') {
        return NextResponse.redirect(new URL(HOME[role] ?? '/role', req.url))
      }
    } catch {
      // DB temporarily unavailable — client-side RoleGuard will enforce on render
    }
  }

  return res
})

export const config = {
  matcher: [
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(api|trpc)(.*)',
  ],
}

import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server'
import { createServerClient } from '@supabase/ssr'
import { NextResponse } from 'next/server'

const isPublic = createRouteMatcher([
  '/',
  '/sign-in(.*)',
  '/sign-up(.*)',
  '/verify(.*)',
  '/role(.*)',
  '/forgot-password(.*)',
  '/sso-callback(.*)',
  '/api/webhooks(.*)',
])

export default clerkMiddleware(async (auth, req) => {
  if (isPublic(req)) return

  const { userId } = auth()

  if (userId) {
    // Clerk OAuth user is signed in — standard Clerk protection
    auth().protect()
    return
  }

  // No Clerk session — check for a Supabase Auth session (email+password users).
  // createBrowserClient stores the session in cookies, so createServerClient can read it here.
  const res = NextResponse.next()
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
  return res
})

export const config = {
  matcher: [
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(api|trpc)(.*)',
  ],
}

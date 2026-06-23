import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

const isPublicRoute = createRouteMatcher([
  '/',
  '/sign-in(.*)',
  '/sign-up(.*)',
  '/admin/login',
  '/api/auth/(.*)',
  '/privacy-policy',
  '/terms',
])

const SESSION_TIMEOUT_MS = 2 * 60 * 60 * 1000   // 2 hours inactivity → logout
const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000  // 7 day absolute max

export default clerkMiddleware(async (auth, request: NextRequest) => {
  const { userId } = await auth()

  if (!userId && !isPublicRoute(request)) {
    return NextResponse.redirect(new URL('/sign-in', request.url))
  }

  if (userId) {
    const response = NextResponse.next()

    // Track last activity timestamp via cookie for inactivity detection
    const now = Date.now()
    const lastActive = Number(request.cookies.get('last_active')?.value ?? 0)
    const sessionStart = Number(request.cookies.get('session_start')?.value ?? now)

    // Absolute session expiry
    if (now - sessionStart > SESSION_MAX_AGE_MS) {
      const res = NextResponse.redirect(new URL('/sign-in?reason=expired', request.url))
      res.cookies.delete('last_active')
      res.cookies.delete('session_start')
      return res
    }

    // Inactivity expiry
    if (lastActive && now - lastActive > SESSION_TIMEOUT_MS) {
      const res = NextResponse.redirect(new URL('/sign-in?reason=inactive', request.url))
      res.cookies.delete('last_active')
      res.cookies.delete('session_start')
      return res
    }

    // Refresh activity cookie on every request
    response.cookies.set('last_active', String(now), { httpOnly: true, sameSite: 'lax' })
    if (!lastActive) {
      response.cookies.set('session_start', String(now), { httpOnly: true, sameSite: 'lax' })
    }

    return response
  }
})

export const config = {
  matcher: ['/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)'],
}

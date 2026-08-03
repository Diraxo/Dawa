import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { rateLimit, LIMITS, getRateLimitId, tooManyRequests } from '@/lib/rateLimit'

// Stream Chat's file/image CDN doesn't send Access-Control-Allow-Origin for
// plain GETs, so a browser-side fetch()/XHR (needed to read the bytes into a
// blob for react-pdf) is blocked by CORS even though the same URL loads fine
// in an <img> tag (which never triggers a CORS check). Proxying the request
// through our own origin sidesteps that entirely — server-to-server requests
// aren't subject to CORS.
const ALLOWED_HOSTS = /(^|\.)stream-io-cdn\.com$/

export async function GET(req: Request) {
  const { userId } = await auth()
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const rl = rateLimit(getRateLimitId(req, userId), LIMITS.chatFileProxy)
  if (!rl.allowed) return tooManyRequests(rl)

  const target = new URL(req.url).searchParams.get('url')
  if (!target) {
    return NextResponse.json({ error: 'Missing url' }, { status: 400 })
  }

  let parsed: URL
  try {
    parsed = new URL(target)
  } catch {
    return NextResponse.json({ error: 'Invalid url' }, { status: 400 })
  }

  // Only ever proxy Stream's own CDN — never an arbitrary attacker-supplied
  // URL, which would otherwise turn this route into an open SSRF proxy.
  if (parsed.protocol !== 'https:' || !ALLOWED_HOSTS.test(parsed.hostname)) {
    return NextResponse.json({ error: 'Host not allowed' }, { status: 400 })
  }

  const upstream = await fetch(parsed, { cache: 'no-store' }).catch(() => null)
  if (!upstream || !upstream.ok || !upstream.body) {
    return NextResponse.json({ error: 'Upstream fetch failed' }, { status: 502 })
  }

  return new Response(upstream.body, {
    headers: {
      'Content-Type': upstream.headers.get('content-type') ?? 'application/octet-stream',
      'Content-Length': upstream.headers.get('content-length') ?? '',
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}

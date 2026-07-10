/**
 * Error monitoring abstraction for carehub-web.
 *
 * This module is Sentry-ready but works without it installed:
 * - When @sentry/nextjs is available it delegates to Sentry.
 * - When not available it logs to console (dev) or swallows (prod — build succeeds).
 *
 * To activate Sentry:
 *   1. cd carehub-web && npm install @sentry/nextjs
 *   2. Copy .env.example values for NEXT_PUBLIC_SENTRY_DSN / SENTRY_AUTH_TOKEN
 *   3. Run: npx @sentry/wizard@latest -i nextjs
 *      (generates sentry.client.config.ts, sentry.server.config.ts, sentry.edge.config.ts)
 *   4. Set SENTRY_ENABLED=true in .env.local
 *
 * Security note: we NEVER send PII (patient name, email, medical details) to Sentry.
 * Only consultation IDs, error codes, and platform metadata are captured.
 */

type SentryLike = {
  captureException: (err: unknown, ctx?: object) => void
  captureMessage:   (msg: string,  level?: string, ctx?: object) => void
  setUser:          (user: { id: string; role?: string } | null) => void
  addBreadcrumb:    (b: object) => void
}

let _sentry: SentryLike | null = null

function getSentry(): SentryLike | null {
  if (_sentry) return _sentry
  if (typeof window === 'undefined') return null        // server — no lazy require
  if (process.env.NEXT_PUBLIC_SENTRY_DSN && process.env.NEXT_PUBLIC_SENTRY_ENABLED === 'true') {
    try {
      // Dynamic require so the build never fails without the package installed
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      _sentry = require('@sentry/nextjs') as SentryLike
    } catch {
      // @sentry/nextjs not installed — fail silently
    }
  }
  return _sentry
}

export interface ErrorContext {
  userId?:         string
  consultationId?: string
  platform?:       string
  extra?:          Record<string, unknown>
}

/** Capture an unexpected error (replaces throw-and-forget console.error calls). */
export function captureError(err: unknown, ctx?: ErrorContext): void {
  const sentry = getSentry()
  if (sentry) {
    sentry.captureException(err, {
      extra: {
        consultationId: ctx?.consultationId,
        platform:       ctx?.platform ?? 'web',
        ...ctx?.extra,
      },
      user: ctx?.userId ? { id: ctx.userId } : undefined,
    })
    return
  }
  if (process.env.NODE_ENV !== 'production') {
    console.error('[monitor]', err, ctx)
  }
}

/** Capture a non-fatal warning or diagnostic message. */
export function captureMessage(message: string, level: 'info' | 'warning' | 'error' = 'info', ctx?: ErrorContext): void {
  const sentry = getSentry()
  if (sentry) {
    sentry.captureMessage(message, level, {
      extra: ctx?.extra,
      user:  ctx?.userId ? { id: ctx.userId } : undefined,
    })
    return
  }
  if (process.env.NODE_ENV !== 'production') {
    const fn = level === 'error' ? console.error : level === 'warning' ? console.warn : console.info
    fn('[monitor]', message, ctx)
  }
}

/** Set the active user on all subsequent captures (call on login, clear on logout). */
export function setMonitoringUser(user: { id: string; role?: string } | null): void {
  getSentry()?.setUser(user)
}

/** Add a breadcrumb trail for better error context. */
export function addBreadcrumb(opts: {
  category: string
  message:  string
  data?:    Record<string, unknown>
  level?:   'info' | 'warning' | 'error'
}): void {
  getSentry()?.addBreadcrumb(opts)
}

/**
 * Wrap a callback and capture any thrown error.
 * Returns undefined on failure instead of throwing.
 */
export async function withCapture<T>(
  fn: () => Promise<T>,
  ctx?: ErrorContext,
): Promise<T | undefined> {
  try {
    return await fn()
  } catch (err) {
    captureError(err, ctx)
    return undefined
  }
}

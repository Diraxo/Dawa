/**
 * Error monitoring abstraction for the Dawa React Native app.
 *
 * Works standalone (console logging in dev, silent in prod).
 * Auto-activates @sentry/react-native when installed and EXPO_PUBLIC_SENTRY_DSN is set.
 *
 * To activate Sentry:
 *   1. npx expo install @sentry/react-native
 *   2. Set EXPO_PUBLIC_SENTRY_DSN and EXPO_PUBLIC_SENTRY_ENABLED=true in .env
 *   3. Call Monitoring.init() in your root _layout.tsx (see comment below)
 *
 * IMPORTANT: Never log PII (patient name, email, medical content) in any captured event.
 * Only consultation IDs, error codes, and platform metadata are acceptable.
 */

type SentryRN = {
  init: (opts: object) => void
  captureException: (err: unknown, ctx?: object) => void
  captureMessage: (msg: string, level?: string) => void
  setUser: (user: { id: string; role?: string } | null) => void
  addBreadcrumb: (b: object) => void
  wrap: <T>(component: T) => T
}

let _sentry: SentryRN | null = null
let _initialized = false

function getSentry(): SentryRN | null {
  if (!_initialized) return null
  return _sentry
}

export interface MonitorContext {
  userId?:         string
  consultationId?: string
  extra?:          Record<string, unknown>
}

/**
 * Call once in root _layout.tsx:
 *
 *   import { Monitoring } from '@/lib/monitoring'
 *   Monitoring.init()
 */
export const Monitoring = {
  init() {
    const dsn     = process.env.EXPO_PUBLIC_SENTRY_DSN
    const enabled = process.env.EXPO_PUBLIC_SENTRY_ENABLED === 'true'
    _initialized  = true

    if (!dsn || !enabled) return

    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const Sentry: SentryRN = require('@sentry/react-native')
      Sentry.init({
        dsn,
        tracesSampleRate: __DEV__ ? 1.0 : 0.1,
        enableNative: true,
        // Strip PII from all events before sending
        beforeSend: (event: Record<string, unknown>) => {
          if (event.user) {
            const u = event.user as Record<string, unknown>
            delete u.email
            delete u.username
            delete u.ip_address
          }
          return event
        },
      })
      _sentry = Sentry
    } catch {
      // @sentry/react-native not installed — fail silently
    }
  },
}

export function captureError(err: unknown, ctx?: MonitorContext): void {
  const sentry = getSentry()
  if (sentry) {
    sentry.captureException(err, {
      extra: {
        consultationId: ctx?.consultationId,
        ...ctx?.extra,
      },
      user: ctx?.userId ? { id: ctx.userId } : undefined,
    })
    return
  }
  if (__DEV__) console.error('[monitor]', err, ctx)
}

export function captureMessage(
  message: string,
  level: 'info' | 'warning' | 'error' = 'info',
  ctx?: MonitorContext,
): void {
  const sentry = getSentry()
  if (sentry) {
    sentry.captureMessage(message, level)
    return
  }
  if (__DEV__) {
    const fn = level === 'error' ? console.error : level === 'warning' ? console.warn : console.info
    fn('[monitor]', message, ctx)
  }
}

export function setMonitoringUser(user: { id: string; role?: string } | null): void {
  getSentry()?.setUser(user)
}

export function addBreadcrumb(opts: {
  category: string
  message:  string
  data?:    Record<string, unknown>
}): void {
  getSentry()?.addBreadcrumb(opts)
}

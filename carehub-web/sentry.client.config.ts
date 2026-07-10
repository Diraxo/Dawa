/**
 * Sentry client-side configuration.
 * Activated when @sentry/nextjs is installed and NEXT_PUBLIC_SENTRY_ENABLED=true.
 *
 * Install: cd carehub-web && npm install @sentry/nextjs
 */
import * as Sentry from '@sentry/nextjs'

const SENTRY_DSN = process.env.NEXT_PUBLIC_SENTRY_DSN

if (SENTRY_DSN && process.env.NEXT_PUBLIC_SENTRY_ENABLED === 'true') {
  Sentry.init({
    dsn: SENTRY_DSN,
    environment: process.env.NODE_ENV,
    release: process.env.NEXT_PUBLIC_APP_VERSION ?? 'unknown',

    // Performance monitoring
    tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,

    // Replay — captures user sessions on error (no PII)
    replaysOnErrorSampleRate: 1.0,
    replaysSessionSampleRate: 0.05,

    integrations: [
      Sentry.replayIntegration({
        // Never record medical information in replays
        maskAllText:   true,
        blockAllMedia: true,
      }),
      Sentry.browserTracingIntegration(),
    ],

    // Filter out non-actionable errors
    ignoreErrors: [
      'ResizeObserver loop limit exceeded',
      'ResizeObserver loop completed with undelivered notifications',
      'Non-Error exception captured',
      'Network request failed',
      'Load failed',
      /ChunkLoadError/,
    ],

    beforeSend(event) {
      // Scrub any accidentally included PII fields
      if (event.request?.cookies) delete event.request.cookies
      if (event.user?.email)      delete event.user.email
      if (event.user?.username)   delete event.user.username
      return event
    },
  })
}

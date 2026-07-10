/**
 * Sentry server-side (Node.js) configuration.
 * Activated when @sentry/nextjs is installed and SENTRY_DSN is set.
 */
import * as Sentry from '@sentry/nextjs'

const SENTRY_DSN = process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN

if (SENTRY_DSN && process.env.NEXT_PUBLIC_SENTRY_ENABLED === 'true') {
  Sentry.init({
    dsn: SENTRY_DSN,
    environment: process.env.NODE_ENV,
    release: process.env.NEXT_PUBLIC_APP_VERSION ?? 'unknown',

    // Low trace rate on server — API routes are high-traffic
    tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.05 : 1.0,

    // Scrub PII from server-side events
    beforeSend(event) {
      if (event.request?.cookies) delete event.request.cookies
      if (event.user?.email)      delete event.user.email
      return event
    },
  })
}

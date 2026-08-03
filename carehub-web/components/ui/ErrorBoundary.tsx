'use client'

import { Component, ReactNode } from 'react'
import { captureError } from '@/lib/monitoring'

interface Props {
  children:   ReactNode
  fallback?:  ReactNode
  context?:   string
}

interface State {
  hasError: boolean
  error:    unknown
}

/**
 * React error boundary that captures exceptions in Sentry (or the monitoring layer)
 * and renders a friendly fallback instead of a blank screen.
 */
export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: unknown): State {
    return { hasError: true, error }
  }

  override componentDidCatch(error: unknown, info: { componentStack: string }) {
    captureError(error, {
      extra: {
        context:        this.props.context,
        componentStack: info.componentStack,
      },
    })
  }

  override render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback
      return (
        <div className="flex flex-col items-center justify-center min-h-[200px] gap-4 p-8">
          <div className="text-4xl">⚠️</div>
          <p className="text-ink-black/60 text-sm text-center max-w-sm">
            Something went wrong. Please refresh the page or contact support if the problem persists.
          </p>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            className="h-9 px-4 rounded-xl bg-cloud-grey text-sm font-semibold text-ink-black hover:bg-steel-grey/20"
          >
            Try again
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

/** Convenience wrapper for page-level error boundaries. */
export function PageErrorBoundary({ children, label }: { children: ReactNode; label: string }) {
  return (
    <ErrorBoundary context={`page:${label}`}>
      {children}
    </ErrorBoundary>
  )
}

import { Component, Suspense, type ReactNode } from 'react'
import { LoadingSpinner } from '@/components/shared/LoadingSpinner'

interface SuspenseWrapperProps {
  children: ReactNode
}

interface RouteErrorBoundaryState {
  hasError: boolean
}

// Catches errors thrown by the lazily-loaded route itself, most notably a
// chunk-load failure after a new deployment — reloading the page picks up
// the current build instead of leaving the user stuck on a blank screen.
class RouteErrorBoundary extends Component<{ children: ReactNode }, RouteErrorBoundaryState> {
  state: RouteErrorBoundaryState = { hasError: false }

  static getDerivedStateFromError(): RouteErrorBoundaryState {
    return { hasError: true }
  }

  componentDidCatch(error: unknown): void {
    console.error('Route failed to render:', error)
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div
          className="content-card mx-auto my-8 flex max-w-sm flex-col items-center gap-3 p-6 text-center"
          data-testid="route-error-boundary"
        >
          <p className="text-sm text-smoke-300">This page failed to load.</p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="rounded-lg bg-flame-400 px-4 py-2 text-sm font-semibold text-charcoal-950 transition-colors hover:bg-flame-500"
            data-testid="route-error-boundary-reload-button"
          >
            Reload
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

export function SuspenseWrapper({ children }: SuspenseWrapperProps) {
  return (
    <RouteErrorBoundary>
      <Suspense fallback={<LoadingSpinner size="sm" />}>{children}</Suspense>
    </RouteErrorBoundary>
  )
}

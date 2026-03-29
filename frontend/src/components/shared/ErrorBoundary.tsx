import { Component, type ReactNode } from 'react'

interface ErrorBoundaryProps {
  children: ReactNode
  fallback?: ReactNode
}

interface ErrorBoundaryState {
  hasError: boolean
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false }

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true }
  }

  render() {
    if (this.state.hasError) {
      return (
        this.props.fallback || (
          <div className="flex flex-col items-center justify-center min-h-[50vh] gap-4 p-8">
            <p className="text-smoke-300 text-lg">Something went wrong</p>
            <button
              onClick={() => this.setState({ hasError: false })}
              className="px-4 py-2 bg-flame-400 text-charcoal-950 rounded-lg font-semibold hover:bg-flame-500 transition-colors"
              data-testid="error-boundary-retry-button"
            >
              Try again
            </button>
          </div>
        )
      )
    }
    return this.props.children
  }
}

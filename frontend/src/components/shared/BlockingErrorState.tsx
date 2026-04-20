import { AlertTriangle } from 'lucide-react'

interface BlockingErrorStateProps {
  title: string
  description: string
  onRetry: () => void
  retryTestId: string
}

/**
 * Full-page error state for blocking route guards and boot-time requests.
 *
 * @example
 * <BlockingErrorState
 *   title="Could not load your subscription"
 *   description="Check your connection and try again."
 *   onRetry={() => void refetch()}
 *   retryTestId="subscription-guard-retry-button"
 * />
 */
export function BlockingErrorState({ title, description, onRetry, retryTestId }: BlockingErrorStateProps) {
  return (
    <div className="flex min-h-screen flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
      <div className="rounded-full border border-red-500/20 bg-red-500/10 p-3 text-red-400">
        <AlertTriangle size={24} />
      </div>
      <div className="space-y-1">
        <p className="text-lg font-semibold text-smoke-100">{title}</p>
        <p className="max-w-sm text-sm text-smoke-400">{description}</p>
      </div>
      <button
        onClick={onRetry}
        className="rounded-lg bg-flame-500 px-4 py-2 font-medium text-white transition-colors hover:bg-flame-600"
        data-testid={retryTestId}
      >
        Try again
      </button>
    </div>
  )
}

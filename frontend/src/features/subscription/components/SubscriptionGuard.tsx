import { useSubscription } from '../hooks/use-subscription'
import { BlockingErrorState } from '@/components/shared/BlockingErrorState'
import { LoadingSpinner } from '@/components/shared/LoadingSpinner'

interface SubscriptionGuardProps {
  children: React.ReactNode
}

/**
 * Loads the user's plan before rendering the page. Free users get in too —
 * Pro-only actions open the paywall through `useProAccess().requirePro`.
 */
export function SubscriptionGuard({ children }: SubscriptionGuardProps) {
  const { isLoading, isError, refetch } = useSubscription()

  if (isLoading) {
    return <LoadingSpinner size="lg" className="flex-1 min-h-screen" />
  }

  if (isError) {
    return (
      <BlockingErrorState
        title="Could not load your subscription"
        description="The app could not verify your access. Check your connection and try again."
        onRetry={() => void refetch()}
        retryTestId="subscription-guard-retry-button"
      />
    )
  }

  return <>{children}</>
}

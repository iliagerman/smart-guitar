import { useState } from 'react'
import { useSubscription } from '../hooks/use-subscription'
import { PaywallDialog } from './PaywallDialog'
import { BlockingErrorState } from '@/components/shared/BlockingErrorState'
import { LoadingSpinner } from '@/components/shared/LoadingSpinner'

interface SubscriptionGuardProps {
  children: React.ReactNode
}

export function SubscriptionGuard({ children }: SubscriptionGuardProps) {
  const { data: status, isLoading, isError, refetch } = useSubscription()
  const [userOpened, setUserOpened] = useState(false)
  const mustShowPaywall = !!(status && !status.has_access)
  const open = mustShowPaywall || userOpened

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

  return (
    <>
      {children}
      <PaywallDialog
        open={open}
        onOpenChange={(open) => {
          // Don't allow closing if no access — user must subscribe
          if (!open && mustShowPaywall) {
            return
          }
          setUserOpened(open)
        }}
        trialEndsAt={status?.trial_ends_at}
      />
    </>
  )
}

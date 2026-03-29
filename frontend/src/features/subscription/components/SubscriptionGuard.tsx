import { useState } from 'react'
import { useSubscription } from '../hooks/use-subscription'
import { PaywallDialog } from './PaywallDialog'
import { LoadingSpinner } from '@/components/shared/LoadingSpinner'

interface SubscriptionGuardProps {
  children: React.ReactNode
}

export function SubscriptionGuard({ children }: SubscriptionGuardProps) {
  const { data: status, isLoading } = useSubscription()
  const [userOpened, setUserOpened] = useState(false)
  const mustShowPaywall = !!(status && !status.has_access)
  const open = mustShowPaywall || userOpened

  if (isLoading) {
    return (
      <LoadingSpinner size="lg" className="flex-1 min-h-screen" />
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

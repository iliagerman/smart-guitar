import { useState } from 'react'
import { useSubscription } from '../hooks/use-subscription'
import { PaywallDialog } from './PaywallDialog'

export function SubscriptionGuard({ children }: { children: React.ReactNode }) {
  const { data: status, isLoading } = useSubscription()
  const [userOpened, setUserOpened] = useState(false)
  const mustShowPaywall = !!(status && !status.has_access)
  const open = mustShowPaywall || userOpened

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="h-8 w-8 rounded-full border-2 border-charcoal-600 border-t-flame-400 animate-spin" />
      </div>
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

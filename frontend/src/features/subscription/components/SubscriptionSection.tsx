import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { CreditCard, Calendar, AlertTriangle } from 'lucide-react'
import { useSubscription } from '../hooks/use-subscription'
import { subscriptionApi } from '@/api/subscription.api'
import { queryKeys } from '@/api/query-keys'
import { PaywallDialog } from './PaywallDialog'
import { cn } from '@/lib/cn'

export function SubscriptionSection() {
  const { data: status, isLoading } = useSubscription()
  const queryClient = useQueryClient()
  const [showPaywall, setShowPaywall] = useState(false)
  const [showCancelConfirm, setShowCancelConfirm] = useState(false)

  const cancelMutation = useMutation({
    mutationFn: subscriptionApi.cancel,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.subscription.all })
      setShowCancelConfirm(false)
    },
  })

  if (isLoading) {
    return (
      <div className="bg-charcoal-800 rounded-xl p-6 border border-charcoal-600 animate-pulse">
        <div className="h-6 w-32 bg-charcoal-700 rounded mb-4" />
        <div className="h-4 w-48 bg-charcoal-700 rounded" />
      </div>
    )
  }

  if (!status) return null

  const sub = status.subscription
  const trialActive = status.trial_active

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return 'N/A'
    return new Date(dateStr).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    })
  }

  return (
    <>
      <div className="bg-charcoal-800 rounded-xl p-6 border border-charcoal-600">
        <h2 className="text-lg font-semibold text-smoke-100 mb-4 flex items-center gap-2">
          <CreditCard size={20} />
          Subscription
        </h2>

        {trialActive && !sub && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <span className="px-2 py-1 rounded bg-blue-500/20 text-blue-400 text-xs font-medium">
                FREE TRIAL
              </span>
            </div>
            <p className="text-smoke-400 text-sm">
              Your trial ends on{' '}
              <span className="text-smoke-200 font-medium">
                {formatDate(status.trial_ends_at)}
              </span>
            </p>
            <button
              onClick={() => setShowPaywall(true)}
              className="w-full py-2.5 bg-flame-500 text-white rounded-lg font-medium hover:bg-flame-600 transition-colors"
            >
              Subscribe Now
            </button>
          </div>
        )}

        {sub && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  'px-2 py-1 rounded text-xs font-medium',
                  sub.status === 'active' && 'bg-green-500/20 text-green-400',
                  sub.status === 'canceled' && 'bg-red-500/20 text-red-400',
                  sub.status === 'past_due' && 'bg-yellow-500/20 text-yellow-400',
                )}
              >
                {sub.status.toUpperCase()}
              </span>
              <span className="text-smoke-400 text-sm capitalize">{sub.plan_type} plan</span>
            </div>

            {sub.current_period_end && (
              <div className="flex items-center gap-2 text-sm text-smoke-400">
                <Calendar size={14} />
                <span>
                  {sub.status === 'canceled' ? 'Access until' : 'Next billing date'}:{' '}
                  <span className="text-smoke-200">{formatDate(sub.current_period_end)}</span>
                </span>
              </div>
            )}

            {sub.status === 'active' && !showCancelConfirm && (
              <button
                onClick={() => setShowCancelConfirm(true)}
                className="w-full py-2.5 bg-charcoal-700 border border-charcoal-600 text-smoke-300 rounded-lg text-sm hover:border-red-500 hover:text-red-500 transition-colors"
              >
                Cancel Subscription
              </button>
            )}

            {showCancelConfirm && (
              <div className="border border-red-500/30 rounded-lg p-4 bg-red-500/5">
                <div className="flex items-center gap-2 mb-2 text-red-400">
                  <AlertTriangle size={16} />
                  <span className="text-sm font-medium">Confirm Cancellation</span>
                </div>
                <p className="text-smoke-400 text-xs mb-3">
                  Your subscription will remain active until the end of the current billing period.
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => cancelMutation.mutate()}
                    disabled={cancelMutation.isPending}
                    className="flex-1 py-2 bg-red-500/20 text-red-400 rounded-lg text-sm font-medium hover:bg-red-500/30 transition-colors disabled:opacity-50"
                  >
                    {cancelMutation.isPending ? 'Canceling...' : 'Yes, Cancel'}
                  </button>
                  <button
                    onClick={() => setShowCancelConfirm(false)}
                    className="flex-1 py-2 bg-charcoal-700 text-smoke-300 rounded-lg text-sm hover:bg-charcoal-600 transition-colors"
                  >
                    Keep Subscription
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {!trialActive && !sub && (
          <div className="space-y-3">
            <p className="text-smoke-400 text-sm">You do not have an active subscription.</p>
            <button
              onClick={() => setShowPaywall(true)}
              className="w-full py-2.5 bg-flame-500 text-white rounded-lg font-medium hover:bg-flame-600 transition-colors"
            >
              Subscribe Now
            </button>
          </div>
        )}
      </div>

      <PaywallDialog
        open={showPaywall}
        onOpenChange={setShowPaywall}
        trialEndsAt={status.trial_ends_at}
      />
    </>
  )
}

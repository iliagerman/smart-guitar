import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { CreditCard, Calendar, AlertTriangle } from 'lucide-react'
import { useSubscription } from '../hooks/use-subscription'
import { subscriptionApi } from '@/api/subscription.api'
import { queryKeys } from '@/api/query-keys'
import { usePaywallStore } from '@/stores/paywall.store'
import { cn } from '@/lib/cn'
import { Skeleton } from '@/components/shared/Skeleton'

const PRO_PERKS = [
  'Mute or solo any instrument: drums, bass, vocals, keys',
  'Add any song from YouTube',
  'Record yourself playing along',
  'AI strumming patterns and chord editing',
]

export function SubscriptionSection() {
  const { data: status, isLoading } = useSubscription()
  const queryClient = useQueryClient()
  const openPaywall = usePaywallStore((s) => s.openPaywall)
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
      <div className="rounded-[1.5rem] border border-white/10 bg-white/[0.04] p-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_20px_60px_rgba(0,0,0,0.35)] backdrop-blur-xl space-y-4">
        <Skeleton className="h-6 w-32 rounded" />
        <Skeleton className="h-4 w-48 rounded" />
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
      <div className="relative overflow-hidden rounded-[1.5rem] border border-white/10 bg-white/[0.04] p-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_20px_60px_rgba(0,0,0,0.35)] backdrop-blur-xl">
        <div className="pointer-events-none absolute -right-16 -top-16 size-48 rounded-full bg-fire-500/20 blur-3xl" aria-hidden="true" />
        <h2 className="relative mb-4 flex items-center gap-2 text-lg font-semibold text-smoke-100">
          <CreditCard size={20} className="text-fire-400" />
          Subscription
        </h2>

        {trialActive && !sub && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <span className="rounded-full bg-fire-500/15 px-2.5 py-1 text-xs font-bold tracking-wide text-fire-300">
                PRO TRIAL
              </span>
            </div>
            <p className="text-smoke-400 text-sm">
              Your trial ends on{' '}
              <span className="text-smoke-200 font-medium">
                {formatDate(status.trial_ends_at)}
              </span>
            </p>
            <ul className="grid gap-1.5 text-sm text-smoke-300">
              {PRO_PERKS.map((perk) => (
                <li key={perk} className="flex items-center gap-2">
                  <span className="grid size-4 place-items-center rounded-full bg-fire-500/20 text-[10px] text-fire-300" aria-hidden="true">✓</span>
                  {perk}
                </li>
              ))}
            </ul>
            <button
              type="button"
              onClick={() => openPaywall('upgrade')}
              className="w-full rounded-full bg-fire-500 py-3 font-extrabold text-white shadow-[0_14px_34px_rgba(249,115,22,0.35)] transition-colors hover:bg-fire-600"
              data-testid="subscription-subscribe-button"
            >
              Keep the whole band: go Pro
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
                type="button"
                onClick={() => setShowCancelConfirm(true)}
                className="w-full py-2.5 bg-charcoal-700 border border-charcoal-600 text-smoke-300 rounded-lg text-sm hover:border-red-500 hover:text-red-500 transition-colors"
                data-testid="subscription-cancel-button"
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
                    type="button"
                    onClick={() => cancelMutation.mutate()}
                    disabled={cancelMutation.isPending}
                    className="flex-1 py-2 bg-red-500/20 text-red-400 rounded-lg text-sm font-medium hover:bg-red-500/30 transition-colors disabled:opacity-50"
                    data-testid="subscription-confirm-cancel-button"
                  >
                    {cancelMutation.isPending ? 'Canceling...' : 'Yes, Cancel'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowCancelConfirm(false)}
                    className="flex-1 py-2 bg-charcoal-700 text-smoke-300 rounded-lg text-sm hover:bg-charcoal-600 transition-colors"
                    data-testid="subscription-keep-button"
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
            <p className="text-smoke-400 text-sm">You’re on the free plan: every song in the library with chords, lyrics, the full mix and the guitar track.</p>
            <ul className="grid gap-1.5 text-sm text-smoke-300">
              {PRO_PERKS.map((perk) => (
                <li key={perk} className="flex items-center gap-2">
                  <span className="grid size-4 place-items-center rounded-full bg-fire-500/20 text-[10px] text-fire-300" aria-hidden="true">✓</span>
                  {perk}
                </li>
              ))}
            </ul>
            <button
              type="button"
              onClick={() => openPaywall('upgrade')}
              className="w-full rounded-full bg-fire-500 py-3 font-extrabold text-white shadow-[0_14px_34px_rgba(249,115,22,0.35)] transition-colors hover:bg-fire-600"
              data-testid="subscription-subscribe-no-trial-button"
            >
              Bring the whole band: go Pro
            </button>
          </div>
        )}
      </div>

    </>
  )
}

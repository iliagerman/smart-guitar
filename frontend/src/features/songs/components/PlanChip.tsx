import { useSubscriptionStore } from '@/stores/subscription.store'
import { usePaywallStore } from '@/stores/paywall.store'
import { getTrialDaysRemaining } from '@/features/subscription/lib/trial-countdown'

/** Shows the user's plan up front: trial days left, or a way to go Pro. */
export function PlanChip() {
  const status = useSubscriptionStore((s) => s.status)
  const openPaywall = usePaywallStore((s) => s.openPaywall)
  if (!status || status.tier === 'pro') return null

  const label = status.tier === 'trial' && status.trial_ends_at
    ? `Pro trial · ${getTrialDaysRemaining(status.trial_ends_at, new Date())}d left`
    : 'Free plan · Go Pro'

  return (
    <button
      type="button"
      onClick={() => openPaywall('upgrade')}
      className="rounded-full border border-fire-500/40 bg-fire-500/10 px-2.5 py-1 text-[11px] font-bold text-fire-300 transition-colors hover:bg-fire-500/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-flame-400/60"
      data-testid="plan-chip"
    >
      {label}
    </button>
  )
}

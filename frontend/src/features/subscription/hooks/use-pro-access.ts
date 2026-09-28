import { useCallback } from 'react'
import { useSubscriptionStore } from '@/stores/subscription.store'
import { usePaywallStore, type PaywallReason, type PaywallSongContext } from '@/stores/paywall.store'

/**
 * Pro access for the current user (active trial or paid plan) and a guard that
 * opens the paywall instead of running a Pro-only action for free users.
 *
 * @example
 * const { requirePro } = useProAccess()
 * if (!requirePro('record')) return
 */
export function useProAccess() {
  // Until the status loads, treat the user as Pro so the UI doesn't flash locks.
  const isPro = useSubscriptionStore((s) => s.status?.has_access ?? true)
  const tier = useSubscriptionStore((s) => s.status?.tier ?? null)
  const openPaywall = usePaywallStore((s) => s.openPaywall)

  const requirePro = useCallback(
    (reason: PaywallReason, song?: PaywallSongContext): boolean => {
      if (isPro) return true
      openPaywall(reason, song)
      return false
    },
    [isPro, openPaywall],
  )

  return { isPro, tier, requirePro }
}

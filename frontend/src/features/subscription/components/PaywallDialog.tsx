import * as Dialog from '@radix-ui/react-dialog'
import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { X } from 'lucide-react'
import { queryKeys } from '@/api/query-keys'
import { subscriptionApi } from '@/api/subscription.api'
import { practiceApi } from '@/api/practice.api'
import { cn } from '@/lib/cn'
import { trackEvent } from '@/lib/meta-pixel'
import { analyticsTracker } from '@/lib/event-tracker'
import { LoadingSpinner } from '@/components/shared/LoadingSpinner'
import { usePaywallStore, type PaywallReason } from '@/stores/paywall.store'
import { useSubscriptionStore } from '@/stores/subscription.store'
import { getTrialDaysRemaining } from '../lib/trial-countdown'
import { BandSeats } from './BandSeats'
import type { PriceDetail } from '@/types/subscription'

type PlanType = 'monthly' | 'yearly'

const PITCH: Record<PaywallReason, string> = {
  stage: 'Step 3 takes the guitar out of the real recording so you play the part yourself, with the band behind you.',
  band_member: 'Remove or solo any instrument in the real recording and take the guitarist’s seat.',
  add_song: 'Add any song from YouTube. We pull the band apart and write out the chords in about 5 minutes.',
  record: 'Record yourself playing with the band and hear how you sound in the real mix.',
  edit: 'Fix the chords your way and save your own versions of every song.',
  upgrade: 'Play along with the real band on every song, add any song you want, and record yourself.',
}

function formatAmount(price: PriceDetail): string {
  const num = parseFloat(price.amount)
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: price.currency,
    minimumFractionDigits: num % 1 === 0 ? 0 : 2,
  }).format(num)
}

function perMonth(price: PriceDetail): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: price.currency }).format(
    parseFloat(price.amount) / 12,
  )
}

/**
 * "The band is waiting" paywall. Opened through the paywall store with the
 * reason the user hit it; free users can always close it and keep using the
 * free steps (Hear it + Learn it).
 */
export function PaywallDialog() {
  const reason = usePaywallStore((s) => s.reason)
  const song = usePaywallStore((s) => s.song)
  const closePaywall = usePaywallStore((s) => s.closePaywall)
  const status = useSubscriptionStore((s) => s.status)
  const open = reason !== null
  const [plan, setPlan] = useState<PlanType>('yearly')

  const { data: prices, isLoading: pricesLoading } = useQuery({
    queryKey: queryKeys.subscription.prices(),
    queryFn: subscriptionApi.getPrices,
    enabled: open,
  })
  const { data: summary } = useQuery({
    queryKey: queryKeys.practice.summary(),
    queryFn: practiceApi.summary,
    enabled: open,
  })

  useEffect(() => {
    if (!reason) return
    analyticsTracker.track({
      event_type: 'paywall_viewed',
      event_category: 'subscription',
      properties: { reason },
    })
  }, [reason])

  // Checkout redirects the whole page to the payment provider on success, so the SPA
  // (and its query cache) is torn down — there is nothing to invalidate.
  // oxlint-disable-next-line react-doctor/query-mutation-missing-invalidation
  const checkout = useMutation({
    mutationFn: (planType: PlanType) => subscriptionApi.checkout(planType),
    onSuccess: (data, planType) => {
      const price = planType === 'yearly' ? prices?.yearly : prices?.monthly
      trackEvent('InitiateCheckout', { currency: price?.currency ?? 'USD', value: Number(price?.amount ?? 0) })
      analyticsTracker.track({
        event_type: 'checkout_started',
        event_category: 'subscription',
        properties: { plan: planType, reason },
      })
      void analyticsTracker.flush({ keepalive: true })
      window.location.href = data.payment_url
    },
  })

  const monthly = prices?.monthly ?? null
  const yearly = prices?.yearly ?? null
  const selectedPlan: PlanType = yearly ? plan : 'monthly'
  const savingsPercent = useMemo(() => {
    if (!monthly || !yearly) return 0
    const monthlyAnnual = parseFloat(monthly.amount) * 12
    return Math.round(((monthlyAnnual - parseFloat(yearly.amount)) / monthlyAnnual) * 100)
  }, [monthly, yearly])

  const trialDays = status?.trial_active && status.trial_ends_at
    ? getTrialDaysRemaining(status.trial_ends_at, new Date())
    : null
  const inProgress = summary?.continue_songs.length ?? 0

  return (
    <Dialog.Root open={open} onOpenChange={(next) => { if (!next) closePaywall() }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-50 max-h-[calc(var(--vv-height)-1rem)] w-[calc(100%-1rem)] max-w-md -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-[1.75rem] border border-fire-500/25 bg-[radial-gradient(120%_55%_at_50%_-8%,rgba(249,115,22,0.5)_0%,rgba(124,45,18,0.25)_40%,#07060a_75%)] px-5 pb-5 pt-7 shadow-[0_30px_90px_rgba(0,0,0,0.6)]"
          data-testid="paywall-dialog"
        >
          <Dialog.Close
            className="absolute right-4 top-4 grid size-9 place-items-center rounded-full bg-white/10 text-smoke-300 transition-colors hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-flame-400/60"
            aria-label="Close"
            data-testid="paywall-close-button"
          >
            <X size={18} aria-hidden="true" />
          </Dialog.Close>

          <BandSeats />
          <Dialog.Title className="mt-4 text-center font-display text-[2.6rem] leading-[0.95] tracking-wide text-smoke-100">
            THE BAND IS<br /><span className="text-fire-500">WAITING FOR YOU.</span>
          </Dialog.Title>
          <Dialog.Description className="mt-2 text-center text-sm leading-relaxed text-smoke-300" data-testid="paywall-pitch">
            {reason ? PITCH[reason] : ''}
          </Dialog.Description>

          {(song || (summary && summary.streak_days > 0)) && (
            <div className="mt-4 rounded-2xl bg-paper-50 px-4 py-3 text-ink-900" data-testid="paywall-progress">
              <div className="flex items-center justify-between text-[10px] font-extrabold tracking-[0.12em] text-ink-400">
                <span>{song ? song.title.toUpperCase() : 'YOUR PROGRESS'}</span>
                {summary && summary.streak_days > 0 && <span>🔥 {summary.streak_days}-day streak</span>}
              </div>
              <div className={cn('mt-2 grid gap-2 text-center', song ? 'grid-cols-3' : 'grid-cols-2')}>
                {song && (
                  <div>
                    <b className="block font-serif text-2xl font-extrabold">{song.learnedChords}</b>
                    <span className="text-[10px] text-ink-600">shapes learned</span>
                  </div>
                )}
                <div>
                  <b className="block font-serif text-2xl font-extrabold">{song ? `${song.completedSteps}/4` : inProgress}</b>
                  <span className="text-[10px] text-ink-600">{song ? 'steps done' : 'songs in progress'}</span>
                </div>
                <div>
                  <b className="block font-serif text-2xl font-extrabold">{summary?.streak_days ?? 0}</b>
                  <span className="text-[10px] text-ink-600">day streak</span>
                </div>
              </div>
            </div>
          )}

          {pricesLoading ? (
            <LoadingSpinner size="md" className="py-8" />
          ) : (
            <div className={cn('mt-4 grid gap-2', yearly ? 'grid-cols-2' : 'grid-cols-1')} role="radiogroup" aria-label="Plan">
              {yearly && (
                <button
                  type="button"
                  role="radio"
                  aria-checked={selectedPlan === 'yearly'}
                  onClick={() => setPlan('yearly')}
                  className={cn(
                    'relative rounded-2xl border-[1.5px] p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-flame-400/60',
                    selectedPlan === 'yearly' ? 'border-fire-500 bg-fire-500/10' : 'border-white/10 bg-white/[0.04] hover:border-white/25',
                  )}
                  data-testid="paywall-yearly-button"
                >
                  {savingsPercent > 0 && (
                    <span className="absolute -top-2.5 right-3 rounded-md bg-fire-500 px-2 py-0.5 text-[10px] font-extrabold text-white">
                      SAVE {savingsPercent}%
                    </span>
                  )}
                  <span className="block text-xs font-bold text-smoke-300">Yearly</span>
                  <span className="block font-display text-4xl leading-none tracking-wide text-smoke-100">{formatAmount(yearly)}</span>
                  <span className="block text-[11px] text-smoke-400">{perMonth(yearly)} / month</span>
                </button>
              )}
              {monthly && (
                <button
                  type="button"
                  role="radio"
                  aria-checked={selectedPlan === 'monthly'}
                  onClick={() => setPlan('monthly')}
                  className={cn(
                    'rounded-2xl border-[1.5px] p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-flame-400/60',
                    selectedPlan === 'monthly' ? 'border-fire-500 bg-fire-500/10' : 'border-white/10 bg-white/[0.04] hover:border-white/25',
                  )}
                  data-testid="paywall-monthly-button"
                >
                  <span className="block text-xs font-bold text-smoke-300">Monthly</span>
                  <span className="block font-display text-4xl leading-none tracking-wide text-smoke-100">{formatAmount(monthly)}</span>
                  <span className="block text-[11px] text-smoke-400">cancel anytime</span>
                </button>
              )}
            </div>
          )}

          <button
            type="button"
            onClick={() => checkout.mutate(selectedPlan)}
            disabled={checkout.isPending || pricesLoading || !monthly}
            className="mt-4 flex w-full items-center justify-center gap-2 rounded-full bg-fire-500 py-3.5 text-base font-extrabold text-white shadow-[0_12px_28px_rgba(249,115,22,0.38)] transition-colors hover:bg-fire-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-flame-400/70 disabled:cursor-not-allowed disabled:opacity-60"
            data-testid="paywall-checkout-button"
          >
            {checkout.isPending && <LoadingSpinner size="xs" inline />}
            Get on stage
          </button>

          {checkout.isError && (
            <p className="mt-2 text-center text-sm text-red-400" role="alert">
              Something went wrong. Please try again.
            </p>
          )}

          <p className="mt-3 text-center text-[11px] leading-relaxed text-smoke-400" data-testid="paywall-footnote">
            {trialDays !== null ? (
              <>Your Pro trial is on — {trialDays} {trialDays === 1 ? 'day' : 'days'} left. Subscribing now keeps the band after it ends.</>
            ) : (
              <>Not now? <b className="text-green-300">Hear it and Learn it stay free</b> for every song. Cancel anytime.</>
            )}
          </p>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

import * as Dialog from '@radix-ui/react-dialog'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Heart, X } from 'lucide-react'
import { queryKeys } from '@/api/query-keys'
import { subscriptionApi } from '@/api/subscription.api'
import { cn } from '@/lib/cn'

interface PaywallDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  trialEndsAt?: string | null
}

function formatAmount(amount: string, currency: string): string {
  const num = parseFloat(amount)
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: num % 1 === 0 ? 0 : 2,
  }).format(num)
}

export function PaywallDialog({ open, onOpenChange, trialEndsAt }: PaywallDialogProps) {
  const { data: prices, isLoading: pricesLoading } = useQuery({
    queryKey: queryKeys.subscription.prices(),
    queryFn: subscriptionApi.getPrices,
    enabled: open,
  })

  const checkout = useMutation({
    mutationFn: (planType: 'monthly' | 'yearly') => subscriptionApi.checkout(planType),
    onSuccess: (data) => {
      window.location.href = data.payment_url
    },
  })

  const monthly = prices?.monthly
  const yearly = prices?.yearly
  const hasYearly = yearly != null

  let savingsPercent = 0
  if (monthly && yearly) {
    const monthlyAnnual = parseFloat(monthly.amount) * 12
    const yearlyAmount = parseFloat(yearly.amount)
    savingsPercent = Math.round(((monthlyAnnual - yearlyAmount) / monthlyAnnual) * 100)
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50" />
        <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-full max-w-md rounded-2xl bg-charcoal-900 border border-charcoal-700 shadow-2xl overflow-hidden">
          <Dialog.Close className="absolute top-4 right-4 text-smoke-500 hover:text-smoke-300 transition-colors z-10">
            <X size={18} />
          </Dialog.Close>

          {/* Header with logo */}
          <div className="flex flex-col items-center pt-8 pb-4 px-6 bg-linear-to-b from-flame-400/10 to-transparent">
            <img
              src="/art/logo.png"
              alt="Smart Guitar"
              className="w-16 h-16 rounded-full object-cover shadow-lg shadow-flame-400/20 mb-4"
            />
            <Dialog.Title className="text-xl font-bold text-smoke-100 text-center">
              {trialEndsAt ? 'Your free trial has ended' : 'Subscribe to Smart Guitar'}
            </Dialog.Title>
          </div>

          <div className="px-6 pb-6">
            {/* Warm message */}
            {trialEndsAt ? (
              <p className="text-smoke-400 text-sm text-center mb-5 leading-relaxed">
                We hope you enjoyed playing with Smart Guitar!
                We charge a small fee to keep the servers running and the music flowing.
                Your support means a lot to us.
              </p>
            ) : (
              <p className="text-smoke-400 text-sm text-center mb-5 leading-relaxed">
                A subscription helps us keep the servers running so you can keep
                learning and playing the songs you love.
              </p>
            )}

            {/* Pricing cards */}
            {pricesLoading ? (
              <div className="flex justify-center py-8">
                <div className="h-8 w-8 rounded-full border-2 border-charcoal-600 border-t-flame-400 animate-spin" />
              </div>
            ) : (
              <div className={cn('grid gap-3 mb-5', hasYearly ? 'grid-cols-2' : 'grid-cols-1')}>
                <button
                  onClick={() => checkout.mutate('monthly')}
                  disabled={checkout.isPending || !monthly}
                  className={cn(
                    'flex flex-col items-center gap-1.5 rounded-xl border p-4 transition-all',
                    hasYearly
                      ? 'border-charcoal-600 hover:border-flame-400 hover:bg-charcoal-800'
                      : 'border-flame-400 hover:bg-charcoal-800',
                    checkout.isPending && 'opacity-50 pointer-events-none',
                  )}
                >
                  <span className="text-xs text-smoke-400 font-medium">Monthly</span>
                  <span className="text-2xl font-bold text-smoke-100">
                    {monthly ? formatAmount(monthly.amount, monthly.currency) : '...'}
                  </span>
                  <span className="text-xs text-smoke-500">per month</span>
                </button>

                {hasYearly && (
                  <button
                    onClick={() => checkout.mutate('yearly')}
                    disabled={checkout.isPending}
                    className={cn(
                      'flex flex-col items-center gap-1.5 rounded-xl border-2 border-flame-400 p-4 transition-all relative',
                      'hover:bg-charcoal-800',
                      checkout.isPending && 'opacity-50 pointer-events-none',
                    )}
                  >
                    {savingsPercent > 0 && (
                      <span className="absolute -top-2.5 bg-flame-400 text-charcoal-950 text-[10px] font-bold px-2.5 py-0.5 rounded-full">
                        SAVE {savingsPercent}%
                      </span>
                    )}
                    <span className="text-xs text-smoke-400 font-medium">Yearly</span>
                    <span className="text-2xl font-bold text-smoke-100">
                      {formatAmount(yearly.amount, yearly.currency)}
                    </span>
                    <span className="text-xs text-smoke-500">per year</span>
                  </button>
                )}
              </div>
            )}

            {checkout.isError && (
              <p className="text-red-500 text-sm text-center mb-3">
                Something went wrong. Please try again.
              </p>
            )}

            {/* Footer note */}
            <p className="flex items-center justify-center gap-1.5 text-xs text-smoke-500 text-center">
              <Heart size={12} className="text-flame-400/60" />
              <span>Cancel anytime from your profile</span>
            </p>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

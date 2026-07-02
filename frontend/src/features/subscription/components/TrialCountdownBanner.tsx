import { X } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useSubscription } from '../hooks/use-subscription'
import { shouldShowTrialCountdown, getTrialDaysRemaining } from '../lib/trial-countdown'
import { useTrialBannerStore } from '@/stores/trial-banner.store'
import { ROUTES } from '@/router/routes'

export function TrialCountdownBanner() {
  const { data: status } = useSubscription()
  const dismissed = useTrialBannerStore((s) => s.dismissed)
  const dismiss = useTrialBannerStore((s) => s.dismiss)

  const trialEndsAt = status?.trial_ends_at

  if (dismissed || !trialEndsAt || !shouldShowTrialCountdown(status ?? null, new Date())) {
    return null
  }

  const daysRemaining = getTrialDaysRemaining(trialEndsAt, new Date())

  return (
    <div
      className="flex items-center justify-between gap-3 bg-flame-400/10 border-b border-flame-400/30 px-4 py-2 text-sm text-smoke-100"
      data-testid="trial-countdown-banner"
    >
      <span>
        Your free trial ends in {daysRemaining} {daysRemaining === 1 ? 'day' : 'days'} —{' '}
        <Link
          to={ROUTES.PROFILE}
          className="font-semibold text-flame-400 hover:text-flame-500 transition-colors"
          data-testid="trial-countdown-banner-subscribe-link"
        >
          Subscribe
        </Link>
      </span>
      <button
        type="button"
        onClick={dismiss}
        className="text-smoke-500 hover:text-smoke-300 transition-colors"
        aria-label="Dismiss trial countdown"
        data-testid="trial-countdown-banner-dismiss-button"
      >
        <X size={16} aria-hidden="true" />
      </button>
    </div>
  )
}

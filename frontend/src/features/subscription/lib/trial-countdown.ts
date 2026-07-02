import type { SubscriptionStatus } from '@/types/subscription'

const MS_PER_DAY = 1000 * 60 * 60 * 24

export function getTrialDaysRemaining(trialEndsAt: string, now: Date): number {
  return Math.ceil((new Date(trialEndsAt).getTime() - now.getTime()) / MS_PER_DAY)
}

export function shouldShowTrialCountdown(status: SubscriptionStatus | null, now: Date): boolean {
  if (!status || !status.trial_active || !status.trial_ends_at) return false
  return getTrialDaysRemaining(status.trial_ends_at, now) <= 3
}

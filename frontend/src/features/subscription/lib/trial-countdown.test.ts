import { describe, it, expect } from 'vitest'
import { getTrialDaysRemaining, shouldShowTrialCountdown } from './trial-countdown'
import type { SubscriptionStatus } from '@/types/subscription'

const NOW = new Date('2026-07-02T00:00:00.000Z')

function buildStatus(overrides: Partial<SubscriptionStatus>): SubscriptionStatus {
  return {
    has_access: true,
    trial_ends_at: null,
    trial_active: false,
    subscription: null,
    has_seen_onboarding: true,
    is_admin: false,
    onboarding_song_id: null,
    ...overrides,
  }
}

describe('getTrialDaysRemaining', () => {
  it('rounds up to whole days remaining', () => {
    expect(getTrialDaysRemaining('2026-07-05T00:00:00.000Z', NOW)).toBe(3)
  })

  it('returns a negative number once the trial has already ended', () => {
    expect(getTrialDaysRemaining('2026-06-30T00:00:00.000Z', NOW)).toBe(-2)
  })
})

describe('shouldShowTrialCountdown', () => {
  it('is false when there is no subscription status', () => {
    expect(shouldShowTrialCountdown(null, NOW)).toBe(false)
  })

  it('is false when the trial is not active', () => {
    const status = buildStatus({ trial_active: false, trial_ends_at: '2026-07-04T00:00:00.000Z' })
    expect(shouldShowTrialCountdown(status, NOW)).toBe(false)
  })

  it('is false when trial_ends_at is missing', () => {
    const status = buildStatus({ trial_active: true, trial_ends_at: null })
    expect(shouldShowTrialCountdown(status, NOW)).toBe(false)
  })

  it('is false when more than 3 days remain', () => {
    const status = buildStatus({ trial_active: true, trial_ends_at: '2026-07-06T00:00:00.000Z' })
    expect(shouldShowTrialCountdown(status, NOW)).toBe(false)
  })

  it('is true when exactly 3 days remain', () => {
    const status = buildStatus({ trial_active: true, trial_ends_at: '2026-07-05T00:00:00.000Z' })
    expect(shouldShowTrialCountdown(status, NOW)).toBe(true)
  })

  it('is true when the trial has already ended but is still marked active', () => {
    const status = buildStatus({ trial_active: true, trial_ends_at: '2026-06-30T00:00:00.000Z' })
    expect(shouldShowTrialCountdown(status, NOW)).toBe(true)
  })
})

import { test, expect } from '../fixtures/auth'
import type { Page } from '@playwright/test'

function mockSubscriptionStatus(page: Page, overrides: { trial_active: boolean; trial_ends_at: string | null }) {
  return page.route('**/api/v1/subscription/status', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        has_access: true,
        trial_ends_at: overrides.trial_ends_at,
        trial_active: overrides.trial_active,
        subscription: null,
        has_seen_onboarding: true,
        is_admin: false,
        onboarding_song_id: null,
      }),
    }),
  )
}

function daysFromNow(days: number): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString()
}

test.describe('Trial countdown banner', () => {
  test('shows when the trial has 3 or fewer days remaining', async ({ authenticatedPage: page }) => {
    await mockSubscriptionStatus(page, { trial_active: true, trial_ends_at: daysFromNow(2) })

    await page.goto('/tuner')

    await expect(page.getByTestId('trial-countdown-banner')).toBeVisible()
    await expect(page.getByTestId('trial-countdown-banner')).toContainText(/trial ends in 2 days/i)
  })

  test('is hidden when more than 3 days remain', async ({ authenticatedPage: page }) => {
    await mockSubscriptionStatus(page, { trial_active: true, trial_ends_at: daysFromNow(10) })

    await page.goto('/tuner')
    await expect(page.getByTestId('sidebar-nav')).toBeVisible()

    await expect(page.getByTestId('trial-countdown-banner')).toHaveCount(0)
  })

  test('is hidden when the trial is not active', async ({ authenticatedPage: page }) => {
    await mockSubscriptionStatus(page, { trial_active: false, trial_ends_at: null })

    await page.goto('/tuner')
    await expect(page.getByTestId('sidebar-nav')).toBeVisible()

    await expect(page.getByTestId('trial-countdown-banner')).toHaveCount(0)
  })

  test('clicking subscribe navigates to the profile page', async ({ authenticatedPage: page }) => {
    await mockSubscriptionStatus(page, { trial_active: true, trial_ends_at: daysFromNow(1) })

    await page.goto('/tuner')
    await page.getByTestId('trial-countdown-banner-subscribe-link').click()

    await expect(page).toHaveURL(/\/profile/)
  })

  test('dismissing the banner hides it for the rest of the session', async ({ authenticatedPage: page }) => {
    await mockSubscriptionStatus(page, { trial_active: true, trial_ends_at: daysFromNow(1) })

    await page.goto('/tuner')
    await expect(page.getByTestId('trial-countdown-banner')).toBeVisible()

    await page.getByTestId('trial-countdown-banner-dismiss-button').click()
    await expect(page.getByTestId('trial-countdown-banner')).toHaveCount(0)

    // Client-side navigation (not a full reload) to confirm the dismissal
    // survives for the rest of the SPA session, not just the current route.
    await page.getByTestId('sidebar-metronome').click()
    await expect(page).toHaveURL(/\/metronome/)
    await expect(page.getByTestId('trial-countdown-banner')).toHaveCount(0)
  })
})

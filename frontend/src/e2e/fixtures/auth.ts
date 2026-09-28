import { test as base, type Page } from '@playwright/test'

// Helper to set auth state in localStorage so the app thinks user is logged in
async function setAuthState(page: Page) {
  await page.addInitScript(() => {
    const authState = {
      state: {
        accessToken: 'test-access-token',
        idToken: 'test-id-token',
        refreshToken: 'test-refresh-token',
        email: 'test@example.com',
        isAuthenticated: true,
      },
      version: 0,
    }
    localStorage.setItem('auth-storage', JSON.stringify(authState))
  })
}

// Mock subscription API so SubscriptionGuard renders children
// instead of hitting the real backend with fake tokens
async function mockSubscriptionApi(page: Page) {
  await page.route('**/api/v1/subscription/status', async (route) => {
    if (route.request().method() !== 'GET') return route.continue()
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        has_access: true,
        tier: 'pro',
        trial_ends_at: null,
        trial_active: false,
        subscription: null,
        has_seen_onboarding: true,
        is_admin: false,
        onboarding_song_id: null,
      }),
    })
  })
}

// Keep specs on loopback: third-party requests (pixel, fonts) never leave the machine.
async function blockExternalTraffic(page: Page) {
  await page.context().route('**/*', (route) => {
    const { hostname } = new URL(route.request().url())
    return hostname === '127.0.0.1' || hostname === 'localhost' ? route.fallback() : route.abort()
  })
}

// Home, paywall and song pages read practice data; a new user has nothing in progress.
async function mockPracticeApi(page: Page) {
  await page.route('**/api/v1/practice/summary', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ skill_level: null, streak_days: 0, practiced_today: false, continue_songs: [] }),
    }),
  )
  await page.route('**/api/v1/practice/songs/*', (route) => {
    const songId = new URL(route.request().url()).pathname.split('/').pop()
    const progress = { song_id: songId, current_step: 1, completed_steps: [], learned_chords: [], stage_progress: 0, last_practiced_at: null }
    const body = route.request().method() === 'PUT' ? { ...progress, ...route.request().postDataJSON() } : progress
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
  })
}

export const test = base.extend<{ authenticatedPage: Page }>({
  authenticatedPage: async ({ page }, runWithPage) => {
    await blockExternalTraffic(page)
    await setAuthState(page)
    await mockSubscriptionApi(page)
    await mockPracticeApi(page)
    await runWithPage(page)
  },
})

export { expect } from '@playwright/test'

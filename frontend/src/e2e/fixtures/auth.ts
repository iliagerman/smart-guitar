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

export const test = base.extend<{ authenticatedPage: Page }>({
  authenticatedPage: async ({ page }, runWithPage) => {
    await setAuthState(page)
    await mockSubscriptionApi(page)
    await runWithPage(page)
  },
})

export { expect } from '@playwright/test'

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

export const test = base.extend<{ authenticatedPage: Page }>({
  authenticatedPage: async ({ page }, runWithPage) => {
    await setAuthState(page)
    await runWithPage(page)
  },
})

export { expect } from '@playwright/test'

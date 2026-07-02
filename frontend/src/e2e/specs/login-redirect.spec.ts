import { test, expect } from '@playwright/test'

const AUTH_TOKENS = { access_token: 'access-1', id_token: 'id-1', refresh_token: 'refresh-1' }

test.describe('Login redirect target', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/auth/login', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(AUTH_TOKENS) }),
    )
    await page.route('**/api/v1/subscription/status', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          has_access: true, trial_ends_at: null, trial_active: false, subscription: null,
          has_seen_onboarding: true, is_admin: false, onboarding_song_id: null,
        }),
      }),
    )
  })

  test('returns to the page that required login instead of always going to the library', async ({ page }) => {
    await page.goto('/tuner')
    await expect(page).toHaveURL(/\/login/)

    await page.getByTestId('login-email').fill('user@example.com')
    await page.getByTestId('login-password').fill('password123')
    await page.getByTestId('login-submit').click()

    await expect(page).toHaveURL(/\/tuner/)
  })

  test('defaults to the songs page when there is no return location', async ({ page }) => {
    await page.goto('/login')

    await page.getByTestId('login-email').fill('user@example.com')
    await page.getByTestId('login-password').fill('password123')
    await page.getByTestId('login-submit').click()

    await expect(page).toHaveURL(/\/songs/)
  })
})

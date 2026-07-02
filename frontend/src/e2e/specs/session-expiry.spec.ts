import { test, expect } from '../fixtures/auth'

test.describe('Session expiry', () => {
  test('shows a session-expired toast and logs the user out when token refresh fails', async ({ authenticatedPage: page }) => {
    await page.route('**/api/v1/favorites', (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ detail: 'expired' }) })
        : route.continue(),
    )
    await page.route('**/auth/refresh', (route) =>
      route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ detail: 'invalid refresh token' }) }),
    )

    await page.goto('/favorites')

    await expect(page.getByText(/session expired/i)).toBeVisible({ timeout: 10000 })
    await expect(page).toHaveURL(/\/login/)
  })
})

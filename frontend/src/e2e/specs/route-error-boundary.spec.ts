import { test, expect } from '../fixtures/auth'

// Simulates a stale-deployment chunk-load failure: the lazily-imported page
// module fails to load, which makes React.lazy throw during render. A
// route-level error boundary should catch it and offer a way to recover.
test.describe('Route error boundary', () => {
  test('shows a reload option instead of a blank page when a route fails to load', async ({ authenticatedPage: page }) => {
    await page.route('**/TunerPage.tsx*', (route) => route.abort())

    await page.goto('/tuner')

    await expect(page.getByTestId('route-error-boundary')).toBeVisible({ timeout: 10000 })
    await expect(page.getByTestId('route-error-boundary-reload-button')).toBeVisible()
  })
})

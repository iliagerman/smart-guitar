import { test, expect } from '../fixtures/auth'

test.describe('Search Page', () => {
  test('search page loads for authenticated users', async ({ authenticatedPage: page }) => {
    await page.goto('/search')
    await expect(page.getByTestId('search-page')).toBeVisible()
    await expect(page.getByTestId('search-input')).toBeVisible()
  })

  test('search input accepts text', async ({ authenticatedPage: page }) => {
    await page.goto('/search')
    const input = page.getByTestId('search-input')
    await input.fill('Stairway to Heaven')
    await expect(input).toHaveValue('Stairway to Heaven')
  })

  test('search displays results from API', async ({ authenticatedPage: page }) => {
    await page.route('**/api/v1/songs/search', (route) => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          results: [
            {
              artist: 'Led Zeppelin',
              song: 'Stairway to Heaven',
              youtube_id: 'abc123',
              title: 'Led Zeppelin - Stairway to Heaven',
              link: 'https://youtube.com/watch?v=abc123',
              thumbnail_url: null,
              duration_seconds: 480,
              exists_locally: false,
              song_id: null,
            },
          ],
        }),
      })
    })

    await page.goto('/search')
    const input = page.getByTestId('search-input')
    await input.fill('Stairway to Heaven')
    await input.press('Enter')

    await expect(page.getByTestId('search-results')).toBeVisible()
    await expect(page.getByTestId('search-result-abc123')).toBeVisible()
    await expect(page.getByText('Stairway to Heaven')).toBeVisible()
    await expect(page.getByText('Led Zeppelin')).toBeVisible()
  })

  test('sidebar navigation is visible on desktop', async ({ authenticatedPage: page }) => {
    await page.goto('/search')
    await expect(page.getByTestId('sidebar-nav')).toBeVisible()
    await expect(page.getByTestId('sidebar-search')).toBeVisible()
    await expect(page.getByTestId('sidebar-library')).toBeVisible()
    await expect(page.getByTestId('sidebar-favorites')).toBeVisible()
    await expect(page.getByTestId('sidebar-profile')).toBeVisible()
  })
})

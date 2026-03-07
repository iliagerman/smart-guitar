import { test, expect } from '../fixtures/auth'

test.describe('Mobile Navigation', () => {
  test.use({ viewport: { width: 390, height: 844 } }) // iPhone 14

  test('bottom nav navigates between pages', async ({ authenticatedPage: page }) => {
    await page.goto('/search')
    await expect(page.getByTestId('search-page')).toBeVisible()

    await page.getByTestId('nav-library').click()
    await expect(page.getByTestId('library-page')).toBeVisible()

    await page.getByTestId('nav-favorites').click()
    await expect(page.getByTestId('favorites-page')).toBeVisible()

    await page.getByTestId('nav-profile').click()
    await expect(page.getByTestId('profile-page')).toBeVisible()

    await page.getByTestId('nav-search').click()
    await expect(page.getByTestId('search-page')).toBeVisible()
  })

  test('favorites page renders with API data', async ({ authenticatedPage: page }) => {
    await page.route('**/api/v1/favorites', (route) => {
      if (route.request().method() === 'GET') {
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            favorites: [
              {
                id: 'fav-1',
                user_id: 'user-1',
                song_id: 'song-1',
                created_at: '2025-01-01T00:00:00Z',
                song: {
                  id: 'song-1',
                  youtube_id: 'yt-1',
                  title: 'Bohemian Rhapsody',
                  artist: 'Queen',
                  duration_seconds: 354,
                  song_name: 'Queen/Bohemian Rhapsody',
                  thumbnail_key: null,
                  audio_key: null,
                },
              },
            ],
          }),
        })
      } else {
        route.continue()
      }
    })

    await page.goto('/favorites')
    await expect(page.getByTestId('favorites-page')).toBeVisible()
    await expect(page.getByTestId('favorites-list')).toBeVisible()
    await expect(page.getByText('Bohemian Rhapsody')).toBeVisible()
  })

  test('profile page shows logout button', async ({ authenticatedPage: page }) => {
    await page.goto('/profile')
    await expect(page.getByTestId('profile-page')).toBeVisible()
    await expect(page.getByTestId('logout-button')).toBeVisible()
  })

  test('logout redirects to login', async ({ authenticatedPage: page }) => {
    await page.goto('/profile')
    await page.getByTestId('logout-button').click()
    await expect(page).toHaveURL(/\/login/)
  })
})

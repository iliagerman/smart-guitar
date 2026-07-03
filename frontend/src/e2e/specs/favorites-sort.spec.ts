import { test, expect } from '../fixtures/auth'

function makeFavorites() {
  return {
    favorites: [
      {
        id: 'fav-1',
        user_id: 'user-1',
        song_id: 'song-1',
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
        song: {
          id: 'song-1',
          youtube_id: 'yt-1',
          title: 'Oldest Least Played',
          artist: 'Artist 1',
          duration_seconds: 200,
          song_name: 'artist_1/song_1',
          thumbnail_key: null,
          thumbnail_url: null,
          audio_key: null,
          play_count: 5,
          created_at: '2024-01-01T00:00:00Z',
        },
      },
      {
        id: 'fav-2',
        user_id: 'user-1',
        song_id: 'song-2',
        created_at: '2024-06-01T00:00:00Z',
        updated_at: '2024-06-01T00:00:00Z',
        song: {
          id: 'song-2',
          youtube_id: 'yt-2',
          title: 'Middle Most Played',
          artist: 'Artist 2',
          duration_seconds: 200,
          song_name: 'artist_2/song_2',
          thumbnail_key: null,
          thumbnail_url: null,
          audio_key: null,
          play_count: 50,
          created_at: '2024-06-01T00:00:00Z',
        },
      },
      {
        id: 'fav-3',
        user_id: 'user-1',
        song_id: 'song-3',
        created_at: '2024-12-01T00:00:00Z',
        updated_at: '2024-12-01T00:00:00Z',
        song: {
          id: 'song-3',
          youtube_id: 'yt-3',
          title: 'Newest Rarely Played',
          artist: 'Artist 3',
          duration_seconds: 200,
          song_name: 'artist_3/song_3',
          thumbnail_key: null,
          thumbnail_url: null,
          audio_key: null,
          play_count: 1,
          created_at: '2024-12-01T00:00:00Z',
        },
      },
    ],
  }
}

async function getVisibleSongOrder(page: import('@playwright/test').Page) {
  const testIds = await page
    .getByTestId('favorites-list')
    .locator('[data-testid^="song-card-"]')
    .evaluateAll((elements) => elements.map((el) => el.getAttribute('data-testid')))
  return testIds.map((id) => id?.replace('song-card-', ''))
}

test.describe('Favorites sorting', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/v1/favorites', async (route) => {
      if (route.request().method() !== 'GET') return route.continue()
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(makeFavorites()),
      })
    })
  })

  test('defaults to recently added order and switches to most played', async ({ authenticatedPage: page }) => {
    await page.goto('/favorites')
    await expect(page.getByTestId('favorites-page')).toBeVisible({ timeout: 15000 })
    await expect(page.getByTestId('favorites-list')).toBeVisible()

    // Default: recently added first (song-3 is newest, song-1 is oldest).
    await expect(page.getByTestId('favorites-sort-recent')).toHaveAttribute('aria-pressed', 'true')
    let order = await getVisibleSongOrder(page)
    expect(order).toEqual(['song-3', 'song-2', 'song-1'])

    // Switch to most played (song-2 has the most plays, song-3 the fewest).
    await page.getByTestId('favorites-sort-most-played').click()
    await expect(page.getByTestId('favorites-sort-most-played')).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByTestId('favorites-sort-recent')).toHaveAttribute('aria-pressed', 'false')

    order = await getVisibleSongOrder(page)
    expect(order).toEqual(['song-2', 'song-1', 'song-3'])
  })

  test('persists the selected sort mode across reloads', async ({ authenticatedPage: page }) => {
    await page.goto('/favorites')
    await expect(page.getByTestId('favorites-list')).toBeVisible()

    await page.getByTestId('favorites-sort-most-played').click()
    await expect(page.getByTestId('favorites-sort-most-played')).toHaveAttribute('aria-pressed', 'true')

    await page.reload()
    await expect(page.getByTestId('favorites-list')).toBeVisible()
    await expect(page.getByTestId('favorites-sort-most-played')).toHaveAttribute('aria-pressed', 'true')

    const order = await getVisibleSongOrder(page)
    expect(order).toEqual(['song-2', 'song-1', 'song-3'])
  })

  test('hides the sort control when there are no favorites', async ({ authenticatedPage: page }) => {
    await page.route('**/api/v1/favorites', async (route) => {
      if (route.request().method() !== 'GET') return route.continue()
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ favorites: [] }),
      })
    })

    await page.goto('/favorites')
    await expect(page.getByTestId('favorites-page')).toBeVisible({ timeout: 15000 })
    await expect(page.getByText('No favorites yet')).toBeVisible()
    await expect(page.getByTestId('favorites-sort-control')).toHaveCount(0)
  })
})

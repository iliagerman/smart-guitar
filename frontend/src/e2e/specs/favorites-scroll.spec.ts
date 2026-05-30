import { test, expect } from '../fixtures/auth'

// More than two full pages (PAGE_SIZE = 20) so paging from page 1 to page 2
// lands on another full, tall page — the scroll position would otherwise be
// preserved across the page change.
const TOTAL_FAVORITES = 45

function makeFavorites() {
  return {
    favorites: Array.from({ length: TOTAL_FAVORITES }, (_, i) => ({
      id: `fav-${i}`,
      user_id: 'user-1',
      song_id: `song-${i}`,
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z',
      song: {
        id: `song-${i}`,
        youtube_id: `yt-${i}`,
        title: `Song ${i}`,
        artist: `Artist ${i}`,
        duration_seconds: 200,
        song_name: `artist_${i}/song_${i}`,
        thumbnail_key: null,
        thumbnail_url: null,
        audio_key: null,
      },
    })),
  }
}

// Walk up from the favorites list to the nearest scrollable ancestor and read
// its scrollTop. Returns -1 if no scrollable ancestor exists.
async function getScrollTop(listLocator: ReturnType<import('@playwright/test').Page['getByTestId']>) {
  return listLocator.evaluate((el) => {
    let node = el.parentElement
    while (node) {
      const overflowY = getComputedStyle(node).overflowY
      if (overflowY === 'auto' || overflowY === 'scroll') return node.scrollTop
      node = node.parentElement
    }
    return -1
  })
}

test.describe('Favorites pagination', () => {
  test('scrolls back to the top when changing pages', async ({ authenticatedPage: page }) => {
    await page.route('**/api/v1/favorites', async (route) => {
      if (route.request().method() !== 'GET') return route.continue()
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(makeFavorites()),
      })
    })

    await page.goto('/favorites')
    await expect(page.getByTestId('favorites-page')).toBeVisible({ timeout: 15000 })

    const list = page.getByTestId('favorites-list')
    await expect(list).toBeVisible()
    await expect(page.getByTestId('pagination-next-button')).toBeVisible()

    // Scroll the favorites container to the bottom.
    await list.evaluate((el) => {
      let node = el.parentElement
      while (node) {
        const overflowY = getComputedStyle(node).overflowY
        if (overflowY === 'auto' || overflowY === 'scroll') {
          node.scrollTop = node.scrollHeight
          return
        }
        node = node.parentElement
      }
    })

    // Sanity: the container actually scrolled.
    expect(await getScrollTop(list)).toBeGreaterThan(0)

    // Go to the next page.
    await page.getByTestId('pagination-next-button').click()

    // The container must return to the top.
    await expect.poll(() => getScrollTop(list), { timeout: 5000 }).toBe(0)
  })
})

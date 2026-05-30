import { test, expect } from '../fixtures/auth'

// More than two full pages (PAGE_SIZE = 20) so paging from page 1 to page 2
// lands on another full, tall page — the scroll position would otherwise be
// preserved across the page change.
const TOTAL_SONGS = 45

function makeSong(i: number) {
  return {
    id: `song-${i}`,
    youtube_id: `yt-${i}`,
    title: `Song ${i}`,
    artist: `Artist ${i}`,
    duration_seconds: 200,
    song_name: `artist_${i}/song_${i}`,
    thumbnail_key: null,
    thumbnail_url: null,
    audio_key: null,
  }
}

// Walk up from the songs list to the nearest scrollable ancestor and read its
// scrollTop. Returns -1 if no scrollable ancestor exists.
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

test.describe('Songs tab pagination', () => {
  test('scrolls back to the top when changing pages', async ({ authenticatedPage: page }) => {
    // "Recently Added" section.
    await page.route('**/api/v1/songs/recent**', async (route) => {
      if (route.request().method() !== 'GET') return route.fallback()
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ items: [makeSong(100), makeSong(101)], total: 2 }),
      })
    })

    // "All Songs" paginated list. Registered after the recent route so it runs
    // first; non-list paths fall back to the more specific handler above.
    await page.route('**/api/v1/songs**', async (route) => {
      if (route.request().method() !== 'GET') return route.fallback()
      const pathname = new URL(route.request().url()).pathname
      if (pathname !== '/api/v1/songs') return route.fallback()
      const items = Array.from({ length: 20 }, (_, i) => makeSong(i))
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ items, total: TOTAL_SONGS }),
      })
    })

    await page.goto('/songs')
    await expect(page.getByTestId('songs-page')).toBeVisible({ timeout: 15000 })

    const list = page.getByTestId('song-library')
    await expect(list).toBeVisible()
    await expect(page.getByTestId('pagination-next-button')).toBeVisible()

    // Scroll the songs container to the bottom.
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

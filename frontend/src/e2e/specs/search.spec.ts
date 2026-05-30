import type { Page } from '@playwright/test'
import { test, expect } from '../fixtures/auth'

// A library song that the local-search endpoint returns for "knock".
const LIBRARY_KNOCK = {
  id: 'lib-1',
  youtube_id: 'lib-yt-1',
  title: "Knockin' on Heaven's Door",
  artist: 'Bob Dylan',
  duration_seconds: 150,
  song_name: 'bob-dylan/knockin-on-heavens-door',
  thumbnail_key: null,
  thumbnail_url: null,
  audio_key: null,
}

// Online (non-library) result that should appear after pressing search.
const ONLINE_FRESH = {
  artist: 'guns-n-roses',
  song: 'knockin-on-heavens-door',
  youtube_id: 'yt-online-2',
  title: "Guns N' Roses - Knockin' on Heaven's Door",
  link: 'https://youtube.com/watch?v=yt-online-2',
  thumbnail_url: null,
  duration_seconds: 336,
  view_count: 1000,
  exists_locally: false,
  song_id: null,
}

// Online result that already exists locally (same song_id as LIBRARY_KNOCK)
// — it must be deduped out of the unified list.
const ONLINE_DUPLICATE = {
  artist: 'bob-dylan',
  song: 'knockin-on-heavens-door',
  youtube_id: 'yt-online-dup',
  title: "Bob Dylan - Knockin' on Heaven's Door",
  link: 'https://youtube.com/watch?v=yt-online-dup',
  thumbnail_url: null,
  duration_seconds: 150,
  view_count: 5000,
  exists_locally: true,
  song_id: 'lib-1',
}

// Online result returned for a query that has no library matches.
const ONLINE_NO_LIBRARY = {
  artist: 'some-artist',
  song: 'rare-track',
  youtube_id: 'yt-online-3',
  title: 'Some Artist - Rare Track',
  link: 'https://youtube.com/watch?v=yt-online-3',
  thumbnail_url: null,
  duration_seconds: 200,
  view_count: 10,
  exists_locally: false,
  song_id: null,
}

/**
 * Mocks every songs endpoint the page touches so the E2E run never hits the
 * real backend. The local-list response is query-aware.
 */
async function mockSongsApi(
  page: Page,
  opts: {
    libraryFor?: (query: string) => unknown[]
    searchResults?: unknown[]
  } = {},
) {
  const libraryFor = opts.libraryFor ?? (() => [])
  const searchResults = opts.searchResults ?? []

  // Recently Added (browse mode) — keep empty.
  await page.route('**/api/v1/songs/recent**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ items: [], total: 0, offset: 0, limit: 10 }),
    }),
  )

  // Online search.
  await page.route('**/api/v1/songs/search', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ results: searchResults }),
    }),
  )

  // Local library list (GET /api/v1/songs?query=...). Regex avoids matching
  // /songs/search, /songs/recent and /songs/:id.
  await page.route(/\/api\/v1\/songs(\?.*)?$/, (route) => {
    const url = new URL(route.request().url())
    const query = url.searchParams.get('query') ?? ''
    const items = libraryFor(query)
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ items, total: items.length, offset: 0, limit: 20 }),
    })
  })
}

test.describe('Unified Songs search', () => {
  test('legacy /search route redirects to the unified songs page', async ({
    authenticatedPage: page,
  }) => {
    await mockSongsApi(page)
    await page.goto('/search')
    await expect(page.getByTestId('songs-page')).toBeVisible()
    await expect(page.getByTestId('songs-search-input')).toBeVisible()
  })

  test('search button is a small icon-only button, not a wide labelled one', async ({
    authenticatedPage: page,
  }) => {
    await mockSongsApi(page)
    await page.goto('/songs')

    const button = page.getByTestId('songs-search-online-button')
    await expect(button).toBeVisible()
    // Small button => labelled via aria-label, no wide "Search Online" text.
    await expect(button).toHaveAttribute('aria-label', /search online/i)
    await expect(button).not.toContainText('Search Online')
  })

  test('typing auto-searches the library and shows matches without a separate section', async ({
    authenticatedPage: page,
  }) => {
    await mockSongsApi(page, {
      libraryFor: (q) => (q.toLowerCase().includes('knock') ? [LIBRARY_KNOCK] : []),
    })
    await page.goto('/songs')

    await page.getByTestId('songs-search-input').fill('knock')

    const results = page.getByTestId('songs-results')
    await expect(results).toBeVisible()
    await expect(results.getByTestId('song-card-lib-1')).toBeVisible()

    // The old split-section headings must be gone.
    await expect(page.getByText('Online Results')).toHaveCount(0)
    await expect(page.getByText('Library Matches')).toHaveCount(0)

    // No online results until the search button is pressed.
    await expect(page.getByTestId('search-result-yt-online-2')).toHaveCount(0)
  })

  test('pressing search appends online results into the same unified list', async ({
    authenticatedPage: page,
  }) => {
    await mockSongsApi(page, {
      libraryFor: (q) => (q.toLowerCase().includes('knock') ? [LIBRARY_KNOCK] : []),
      searchResults: [ONLINE_FRESH, ONLINE_DUPLICATE],
    })
    await page.goto('/songs')

    await page.getByTestId('songs-search-input').fill('knock')
    const results = page.getByTestId('songs-results')
    await expect(results.getByTestId('song-card-lib-1')).toBeVisible()

    await page.getByTestId('songs-search-online-button').click()

    // Both the library card and the fresh online result live in ONE container.
    await expect(results.getByTestId('song-card-lib-1')).toBeVisible()
    await expect(results.getByTestId('search-result-yt-online-2')).toBeVisible()
  })

  test('online result that already exists locally is deduped out', async ({
    authenticatedPage: page,
  }) => {
    await mockSongsApi(page, {
      libraryFor: (q) => (q.toLowerCase().includes('knock') ? [LIBRARY_KNOCK] : []),
      searchResults: [ONLINE_FRESH, ONLINE_DUPLICATE],
    })
    await page.goto('/songs')

    await page.getByTestId('songs-search-input').fill('knock')
    await page.getByTestId('songs-search-online-button').click()

    await expect(page.getByTestId('search-result-yt-online-2')).toBeVisible()
    // The duplicate (song_id === lib-1, already shown as a library card) is hidden.
    await expect(page.getByTestId('search-result-yt-online-dup')).toHaveCount(0)
  })

  test('no library matches shows an online prompt instead of a dead-end', async ({
    authenticatedPage: page,
  }) => {
    await mockSongsApi(page, {
      libraryFor: () => [],
      searchResults: [ONLINE_NO_LIBRARY],
    })
    await page.goto('/songs')

    await page.getByTestId('songs-search-input').fill('rare track')

    const prompt = page.getByTestId('songs-search-online-prompt')
    await expect(prompt).toBeVisible()

    // Triggering the online search from the prompt fills the unified list.
    await page.getByTestId('songs-search-online-cta').click()
    await expect(
      page.getByTestId('songs-results').getByTestId('search-result-yt-online-3'),
    ).toBeVisible()
  })
})

test.describe('YouTube preview before processing', () => {
  // Keep the YouTube embed hermetic so the test never depends on real network
  // or actual playback — we only ever assert on the iframe's src attribute.
  async function blockYouTubeEmbed(page: Page) {
    await page.route('**/www.youtube.com/embed/**', (route) =>
      route.fulfill({ status: 200, contentType: 'text/html', body: '' }),
    )
  }

  async function gotoWebResult(page: Page) {
    await mockSongsApi(page, { libraryFor: () => [], searchResults: [ONLINE_NO_LIBRARY] })
    await blockYouTubeEmbed(page)
    await page.goto('/songs')
    await page.getByTestId('songs-search-input').fill('rare track')
    await page.getByTestId('songs-search-online-cta').click()
    await expect(page.getByTestId('search-result-yt-online-3')).toBeVisible()
  }

  test('clicking a web result opens a YouTube preview instead of downloading immediately', async ({
    authenticatedPage: page,
  }) => {
    let selectCalled = false
    await page.route('**/api/v1/songs/select', (route) => {
      selectCalled = true
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
    })

    await gotoWebResult(page)
    await page.getByTestId('search-result-yt-online-3').click()

    const dialog = page.getByTestId('search-preview-dialog')
    await expect(dialog).toBeVisible()
    // The embedded player must point at the selected video.
    await expect(dialog.getByTestId('search-preview-player')).toHaveAttribute('src', /yt-online-3/)
    // Previewing must NOT kick off the heavy download/process pipeline.
    expect(selectCalled).toBe(false)
  })

  test('cancelling the preview closes it without downloading', async ({
    authenticatedPage: page,
  }) => {
    let selectCalled = false
    await page.route('**/api/v1/songs/select', (route) => {
      selectCalled = true
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
    })

    await gotoWebResult(page)
    await page.getByTestId('search-result-yt-online-3').click()
    await expect(page.getByTestId('search-preview-dialog')).toBeVisible()

    await page.getByTestId('search-preview-cancel-button').click()

    await expect(page.getByTestId('search-preview-dialog')).toHaveCount(0)
    expect(selectCalled).toBe(false)
  })

  test('confirming the preview starts the download for the selected video', async ({
    authenticatedPage: page,
  }) => {
    await page.route('**/api/v1/songs/select', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ song: { id: 'dl-1' } }),
      }),
    )

    await gotoWebResult(page)
    await page.getByTestId('search-result-yt-online-3').click()
    await expect(page.getByTestId('search-preview-dialog')).toBeVisible()

    const selectRequest = page.waitForRequest('**/api/v1/songs/select')
    await page.getByTestId('search-preview-confirm-button').click()
    const request = await selectRequest

    // The confirm handoff fires the existing select endpoint with the right video.
    expect(request.postDataJSON()).toMatchObject({ youtube_id: 'yt-online-3' })
  })
})

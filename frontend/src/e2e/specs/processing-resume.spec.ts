import { test, expect } from '../fixtures/auth'

const songId = '0b59abe8-4eac-4245-8cc1-2bceea4a3368'
const activeJobId = 'aaaa1111-bbbb-cccc-dddd-eeee2222ffff'

function makeSongDetail(overrides: Record<string, unknown> = {}) {
  return {
    song: {
      id: songId,
      youtube_id: 'abc123',
      title: 'Test Song',
      artist: 'Test Artist',
      duration_seconds: 300,
      song_name: 'test_artist/test_song',
      thumbnail_key: null,
      audio_key: null,
    },
    thumbnail_url: null,
    audio_url: null,
    stems: {},
    stem_types: [
      { name: 'vocals', label: 'Vocals' },
      { name: 'guitar', label: 'Guitar' },
    ],
    chords: [],
    lyrics: [],
    lyrics_source: null,
    quick_lyrics: [],
    quick_lyrics_source: null,
    chord_options: [],
    tabs: [],
    strums: [],
    rhythm: null,
    active_job: null,
    ...overrides,
  }
}

function makeJobResponse(overrides: Record<string, unknown> = {}) {
  return {
    id: activeJobId,
    user_id: 'user-123',
    song_id: songId,
    status: 'PROCESSING',
    progress: 45,
    stage: 'separating',
    descriptions: ['vocals', 'guitar'],
    mode: 'isolate',
    error_message: null,
    results: null,
    created_at: '2026-02-22T10:00:00Z',
    updated_at: '2026-02-22T10:01:00Z',
    completed_at: null,
    ...overrides,
  }
}

test.describe('Processing resume on refresh/navigation', () => {
  test('resumes polling existing job without creating a new one', async ({ authenticatedPage: page }) => {
    let jobCreateCalled = false

    // Mock favorites
    await page.route('**/api/v1/favorites', async (route) => {
      if (route.request().method() !== 'GET') return route.continue()
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ favorites: [] }),
      })
    })

    // Mock song detail WITH active_job — simulates refresh during generation
    await page.route(`**/api/v1/songs/${songId}`, async (route) => {
      if (route.request().method() !== 'GET') return route.continue()
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(
          makeSongDetail({
            active_job: {
              id: activeJobId,
              status: 'PROCESSING',
              progress: 45,
              stage: 'separating',
            },
          }),
        ),
      })
    })

    // Mock job polling endpoint
    await page.route(`**/api/v1/jobs/${activeJobId}`, async (route) => {
      if (route.request().method() !== 'GET') return route.continue()
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(makeJobResponse()),
      })
    })

    // Mock job SSE endpoint
    await page.route(`**/api/v1/jobs/${activeJobId}/events`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: 'event: hello\ndata: {}\n\n',
      })
    })

    // Intercept job creation — should NOT be called
    await page.route('**/api/v1/jobs', async (route) => {
      if (route.request().method() === 'POST') {
        jobCreateCalled = true
      }
      await route.continue()
    })

    await page.goto(`/songs/${songId}`)
    await expect(page.getByTestId('song-detail-page')).toBeVisible()

    // Wait a moment for any mount effects to fire
    await page.waitForTimeout(1000)

    expect(jobCreateCalled).toBe(false)
  })

  test('creates a new job when no active job exists and song is incomplete', async ({ authenticatedPage: page }) => {
    let jobCreateCalled = false

    // Mock favorites
    await page.route('**/api/v1/favorites', async (route) => {
      if (route.request().method() !== 'GET') return route.continue()
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ favorites: [] }),
      })
    })

    // Mock song detail WITHOUT active_job and no stems
    await page.route(`**/api/v1/songs/${songId}`, async (route) => {
      if (route.request().method() !== 'GET') return route.continue()
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(makeSongDetail()),
      })
    })

    // Intercept job creation — SHOULD be called
    await page.route('**/api/v1/jobs', async (route) => {
      if (route.request().method() === 'POST') {
        jobCreateCalled = true
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(makeJobResponse({ id: 'new-job-id', status: 'PENDING', progress: 0, stage: 'queued' })),
        })
        return
      }
      await route.continue()
    })

    // Mock job polling for the newly created job
    await page.route('**/api/v1/jobs/new-job-id', async (route) => {
      if (route.request().method() !== 'GET') return route.continue()
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(makeJobResponse({ id: 'new-job-id', status: 'PENDING', progress: 0, stage: 'queued' })),
      })
    })

    // Mock SSE endpoint
    await page.route('**/api/v1/jobs/new-job-id/events', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: 'event: hello\ndata: {}\n\n',
      })
    })

    await page.goto(`/songs/${songId}`)
    await expect(page.getByTestId('song-detail-page')).toBeVisible()

    // Wait for mount effect to fire
    await page.waitForTimeout(1000)

    expect(jobCreateCalled).toBe(true)
  })

  test('shows processing indicator for another user viewing the same song', async ({ authenticatedPage: page }) => {
    // Mock favorites
    await page.route('**/api/v1/favorites', async (route) => {
      if (route.request().method() !== 'GET') return route.continue()
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ favorites: [] }),
      })
    })

    // Mock song detail with active_job from another user
    await page.route(`**/api/v1/songs/${songId}`, async (route) => {
      if (route.request().method() !== 'GET') return route.continue()
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(
          makeSongDetail({
            active_job: {
              id: activeJobId,
              status: 'PROCESSING',
              progress: 60,
              stage: 'recognizing_chords',
            },
          }),
        ),
      })
    })

    // Mock job polling — returns progress from the other user's job
    await page.route(`**/api/v1/jobs/${activeJobId}`, async (route) => {
      if (route.request().method() !== 'GET') return route.continue()
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(
          makeJobResponse({
            user_id: 'other-user-id',
            progress: 60,
            stage: 'recognizing_chords',
          }),
        ),
      })
    })

    // Mock SSE endpoint
    await page.route(`**/api/v1/jobs/${activeJobId}/events`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: 'event: hello\ndata: {}\n\n',
      })
    })

    await page.goto(`/songs/${songId}`)
    await expect(page.getByTestId('song-detail-page')).toBeVisible()

    // The processing progress UI should be visible (showing the other user's job progress)
    await expect(page.getByText('60%')).toBeVisible()
  })
})

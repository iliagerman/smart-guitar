import { test, expect } from '../fixtures/auth'

const songId = '0b59abe8-4eac-4245-8cc1-2bceea4a3368'
const failedJobId = 'aaaa1111-bbbb-cccc-dddd-eeee2222ffff'
const retryJobId = 'bbbb2222-cccc-dddd-eeee-ffff33334444'

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
      thumbnail_url: null,
      audio_key: null,
    },
    thumbnail_url: null,
    audio_url: null,
    stems: { vocals: 'https://example.com/vocals.mp3', guitar: 'https://example.com/guitar.mp3' },
    stem_types: [
      { name: 'vocals', label: 'Vocals' },
      { name: 'guitar', label: 'Guitar' },
    ],
    chords: [],
    lyrics: [],
    lyrics_source: null,
    quick_lyrics: [],
    quick_lyrics_source: null,
    corrected_lyrics: [],
    corrected_lyrics_source: null,
    chord_options: [
      {
        name: 'Detected', description: 'Auto-detected chords', capo: 0, hidden: false, is_variant: false,
        version_key: null, created_by: null, vote_score: 0, lyrics_source: null,
        chords: [{ start_time: 0, end_time: 2, chord: 'G', bass: null }], lyrics: [],
      },
    ],
    chord_source: 'autochord',
    tabs: [],
    strums: [],
    rhythm: null,
    sections: [],
    active_job: null,
    download_pending: false,
    ...overrides,
  }
}

function makeJobResponse(overrides: Record<string, unknown> = {}) {
  return {
    id: failedJobId,
    user_id: 'user-123',
    song_id: songId,
    status: 'FAILED',
    progress: 40,
    stage: 'transcribing_lyrics',
    descriptions: ['vocals', 'guitar'],
    mode: 'isolate',
    error_message: 'Lyrics generation failed',
    results: null,
    created_at: '2026-02-22T10:00:00Z',
    updated_at: '2026-02-22T10:01:00Z',
    completed_at: null,
    ...overrides,
  }
}

test.describe('Background processing retry', () => {
  test('lets the user retry a failed background lyrics/tabs job', async ({ authenticatedPage: page }) => {
    let jobCreateCalled = false

    await page.route('**/api/v1/favorites', async (route) => {
      if (route.request().method() !== 'GET') return route.continue()
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ favorites: [] }) })
    })

    await page.route(`**/api/v1/songs/${songId}`, async (route) => {
      if (route.request().method() !== 'GET') return route.continue()
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(
          makeSongDetail({
            active_job: { id: failedJobId, status: 'FAILED', progress: 40, stage: 'transcribing_lyrics' },
          }),
        ),
      })
    })

    await page.route(`**/api/v1/jobs/${failedJobId}`, async (route) => {
      if (route.request().method() !== 'GET') return route.continue()
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(makeJobResponse()) })
    })

    await page.route(`**/api/v1/jobs/${failedJobId}/events`, async (route) => {
      await route.fulfill({ status: 200, contentType: 'text/event-stream', body: 'event: hello\ndata: {}\n\n' })
    })

    await page.route('**/api/v1/jobs', async (route) => {
      if (route.request().method() === 'POST') {
        jobCreateCalled = true
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(makeJobResponse({ id: retryJobId, status: 'PENDING', progress: 0, error_message: null })),
        })
        return
      }
      await route.continue()
    })

    await page.route(`**/api/v1/jobs/${retryJobId}`, async (route) => {
      if (route.request().method() !== 'GET') return route.continue()
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(makeJobResponse({ id: retryJobId, status: 'PENDING', progress: 0, error_message: null })),
      })
    })

    await page.route(`**/api/v1/jobs/${retryJobId}/events`, async (route) => {
      await route.fulfill({ status: 200, contentType: 'text/event-stream', body: 'event: hello\ndata: {}\n\n' })
    })

    await page.goto(`/songs/${songId}`)

    const card = page.getByTestId('background-processing-card')
    await expect(card).toBeVisible({ timeout: 15000 })
    await expect(card).toContainText(/background generation failed/i)

    await card.getByTestId('background-processing-retry-button').click()

    expect(jobCreateCalled).toBe(true)
    await expect(card).toContainText(/generating in background/i)
  })
})

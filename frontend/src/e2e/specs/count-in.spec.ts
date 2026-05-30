import { test, expect } from '../fixtures/auth'

// NOTE: This validates the count-in OVERLAY, its timing, and cancellation only.
// It runs on desktop Chromium, which does NOT enforce the mobile gesture-activation
// autoplay policy — so it does NOT verify the iOS Safari single-track audio unlock.
// That path (muted play()->pause() prime) must be checked on a real iOS device.

const SONG_ID = '0b59abe8-4eac-4245-8cc1-2bceea4a3368'

const CHORDS = [
  { start_time: 0, end_time: 2, chord: 'G', bass: null },
  { start_time: 2, end_time: 4, chord: 'C', bass: null },
]
const LYRICS = [
  { start: 0, end: 4, text: 'la la', words: [{ word: 'la', start: 0, end: 2 }, { word: 'la', start: 2, end: 4 }] },
]

// One processed stem -> single-track playback mode with both play guards clear.
const SONG_DETAIL = {
  song: {
    id: SONG_ID, youtube_id: 'abc123', title: 'Knockin', artist: 'Dylan', duration_seconds: 180,
    song_name: 'dylan/knockin', thumbnail_key: null, thumbnail_url: null, audio_key: null,
  },
  thumbnail_url: null, audio_url: null,
  stems: { guitar: 'http://localhost:5173/fake-guitar.mp3' },
  stem_types: [{ name: 'guitar' }],
  chords: [], lyrics: LYRICS, lyrics_source: 'detected', quick_lyrics: [], quick_lyrics_source: null,
  corrected_lyrics: [], corrected_lyrics_source: null,
  chord_options: [{
    name: 'Detected', description: 'Auto-detected chords', capo: 0, hidden: false, is_variant: false,
    version_key: null, created_by: null, vote_score: 0, lyrics_source: 'detected', chords: CHORDS, lyrics: LYRICS,
  }],
  chord_source: 'autochord', recommended_capo: null, song_key: 'G',
  tabs: [], strums: [], rhythm: null, sections: [], active_job: null, download_pending: false,
}

test.describe('Playback count-in', () => {
  test.beforeEach(async ({ authenticatedPage: page }) => {
    await page.route('**/api/v1/favorites', (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ favorites: [] }) })
        : route.continue(),
    )
    await page.route(`**/api/v1/songs/${SONG_ID}`, (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(SONG_DETAIL) })
        : route.continue(),
    )
    await page.route('**/api/v1/songs/*/play', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) }),
    )
  })

  test('pressing play shows a 3-2-1 count-in before playback', async ({ authenticatedPage: page }) => {
    await page.goto(`/songs/${SONG_ID}`)
    const playButton = page.getByTestId('player-play-button')
    await expect(playButton).toBeVisible()

    await playButton.click()

    const overlay = page.getByTestId('count-in-overlay')
    await expect(overlay).toBeVisible()
    // Starts at a digit and counts down to 1, then clears.
    await expect(page.getByTestId('count-in-number')).toHaveText(/^[123]$/)
    await expect(page.getByTestId('count-in-number')).toHaveText('1', { timeout: 4000 })
    await expect(overlay).toBeHidden({ timeout: 4000 })
  })

  test('tapping the overlay cancels the count-in', async ({ authenticatedPage: page }) => {
    await page.goto(`/songs/${SONG_ID}`)
    const playButton = page.getByTestId('player-play-button')
    await expect(playButton).toBeVisible()

    await playButton.click()
    const overlay = page.getByTestId('count-in-overlay')
    await expect(overlay).toBeVisible()

    await overlay.click()
    await expect(overlay).toBeHidden()

    // It stays cancelled — playback never auto-starts past the (cancelled) countdown.
    await page.waitForTimeout(1500)
    await expect(overlay).toBeHidden()
    await expect(page.getByTestId('player-play-button')).toHaveAttribute('aria-label', 'Play')
  })

  test('count-in can be turned off', async ({ authenticatedPage: page }) => {
    await page.goto(`/songs/${SONG_ID}`)

    const toggle = page.getByTestId('count-in-toggle')
    await expect(toggle).toBeVisible()
    await expect(toggle).toHaveAttribute('aria-pressed', 'true')
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-pressed', 'false')

    await page.getByTestId('player-play-button').click()
    // No countdown overlay should appear when the feature is off.
    await expect(page.getByTestId('count-in-overlay')).toHaveCount(0)
    await page.waitForTimeout(600)
    await expect(page.getByTestId('count-in-overlay')).toHaveCount(0)
  })
})

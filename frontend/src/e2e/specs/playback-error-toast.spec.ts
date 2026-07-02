import { test, expect } from '../fixtures/auth'

const SONG_ID = 'b2c3d4e5-4eac-4245-8cc1-2bceea4a3369'

const CHORDS = [{ start_time: 0, end_time: 2, chord: 'G', bass: null }]
const LYRICS = [
  { start: 0, end: 2, text: 'la', words: [{ word: 'la', start: 0, end: 2 }] },
]

const SONG_DETAIL = {
  song: {
    id: SONG_ID, youtube_id: 'abc123', title: 'Knockin', artist: 'Dylan', duration_seconds: 180,
    song_name: 'dylan/knockin', thumbnail_key: null, thumbnail_url: null, audio_key: null,
  },
  thumbnail_url: null, audio_url: null,
  stems: { guitar: 'processed' },
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

test.describe('Playback error toast', () => {
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
    // Force the audio element to fail loading so `audio.onerror` fires.
    await page.route(`**/api/v1/songs/${SONG_ID}/stream*`, (route) =>
      route.fulfill({ status: 500, contentType: 'text/plain', body: 'boom' }),
    )
  })

  test('shows a friendly toast instead of a native alert when playback fails to load', async ({ authenticatedPage: page }) => {
    let nativeAlertShown = false
    page.on('dialog', (dialog) => {
      nativeAlertShown = true
      void dialog.dismiss()
    })

    await page.goto(`/songs/${SONG_ID}`)

    await expect(page.getByText(/playback failed/i)).toBeVisible({ timeout: 10000 })
    expect(nativeAlertShown).toBe(false)
  })
})

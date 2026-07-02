import type { Page } from '@playwright/test'
import { test, expect } from '../fixtures/auth'

// Real, short, statically-served media file used as a stand-in "stem" so the
// audio element actually loads metadata (duration) and can be played/seeked.
const FAKE_STEM_FILE = new URL('../../../public/guitar.mp4', import.meta.url).pathname

async function waitForDuration(page: Page) {
  await expect(page.getByTestId('transport-duration')).not.toHaveText('0:00', { timeout: 10000 })
}

const SONG_ID = 'a1b2c3d4-4eac-4245-8cc1-2bceea4a3368'

const CHORDS = [
  { start_time: 0, end_time: 2, chord: 'G', bass: null },
  { start_time: 2, end_time: 4, chord: 'C', bass: null },
]
const LYRICS = [
  { start: 0, end: 4, text: 'la la', words: [{ word: 'la', start: 0, end: 2 }, { word: 'la', start: 2, end: 4 }] },
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

test.describe('Player keyboard shortcuts', () => {
  test.beforeEach(async ({ authenticatedPage: page }) => {
    // Disable count-in so Space toggles playback immediately instead of
    // starting a count-in sequence first.
    await page.addInitScript(() => {
      localStorage.setItem('player-prefs', JSON.stringify({ state: { countInEnabled: false }, version: 17 }))
    })
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
    await page.route(`**/api/v1/songs/${SONG_ID}/stream*`, (route) =>
      route.fulfill({ path: FAKE_STEM_FILE, contentType: 'video/mp4', headers: { 'Accept-Ranges': 'bytes' } }),
    )
  })

  test('Space toggles play/pause', async ({ authenticatedPage: page }) => {
    await page.goto(`/songs/${SONG_ID}`)
    await waitForDuration(page)

    const playButton = page.getByTestId('player-play-button')
    await expect(playButton).toHaveAttribute('aria-label', 'Play')

    await page.keyboard.press('Space')
    await expect(playButton).toHaveAttribute('aria-label', 'Pause')

    await page.keyboard.press('Space')
    await expect(playButton).toHaveAttribute('aria-label', 'Play')
  })

  test('ArrowLeft and ArrowRight seek the play head by 5 seconds', async ({ authenticatedPage: page }) => {
    await page.goto(`/songs/${SONG_ID}`)
    await waitForDuration(page)

    const progressBar = page.getByTestId('transport-progress-bar')

    await page.keyboard.press('ArrowRight')
    await expect(progressBar).toHaveAttribute('aria-valuetext', /0:05 of/)

    await page.keyboard.press('ArrowLeft')
    await expect(progressBar).toHaveAttribute('aria-valuetext', /0:00 of/)
  })

  test('L cycles the A/B loop like the loop button', async ({ authenticatedPage: page }) => {
    await page.goto(`/songs/${SONG_ID}`)
    await waitForDuration(page)

    const loopButton = page.getByTestId('ab-loop-toggle')
    await expect(loopButton).toHaveAttribute('aria-pressed', 'false')

    await page.keyboard.press('l')
    await expect(page.getByTestId('transport-loop-marker-a')).toBeVisible()

    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('l')
    await expect(loopButton).toHaveAttribute('aria-pressed', 'true')

    await page.keyboard.press('l')
    await expect(loopButton).toHaveAttribute('aria-pressed', 'false')
  })

  test('shortcuts are ignored while typing in a text input', async ({ authenticatedPage: page }) => {
    await page.goto(`/songs/${SONG_ID}`)
    await waitForDuration(page)

    await page.evaluate(() => {
      const input = document.createElement('input')
      input.setAttribute('data-testid', 'test-focus-input')
      document.body.appendChild(input)
      input.focus()
    })

    const playButton = page.getByTestId('player-play-button')
    await expect(playButton).toHaveAttribute('aria-label', 'Play')

    await page.keyboard.press('Space')
    await expect(playButton).toHaveAttribute('aria-label', 'Play')
  })

  test('shortcuts are ignored while a dialog is open', async ({ authenticatedPage: page }) => {
    await page.goto(`/songs/${SONG_ID}`)
    await waitForDuration(page)

    await page.evaluate(() => {
      const dialog = document.createElement('div')
      dialog.setAttribute('role', 'dialog')
      const button = document.createElement('button')
      button.setAttribute('data-testid', 'test-dialog-button')
      dialog.appendChild(button)
      document.body.appendChild(dialog)
      button.focus()
    })

    const playButton = page.getByTestId('player-play-button')
    await expect(playButton).toHaveAttribute('aria-label', 'Play')

    await page.keyboard.press('Space')
    await expect(playButton).toHaveAttribute('aria-label', 'Play')
  })
})

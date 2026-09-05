import type { Page } from '@playwright/test'
import { test, expect } from '../fixtures/auth'

// Real, short, statically-served media file used as a stand-in "stem" so the
// audio element actually loads metadata (duration) in Chromium.
const FAKE_STEM_FILE = new URL('../../../public/guitar.mp4', import.meta.url).pathname

// The progress bar only exposes loop markers once duration is known, which
// happens after the audio element's metadata finishes loading.
async function waitForDuration(page: Page) {
  await expect(page.getByTestId('transport-duration')).not.toHaveText('0:00', { timeout: 10000 })
}

// NOTE: This validates the A/B loop button cycle (set A -> set B -> clear) and
// its progress-bar markers, using the app's own static /guitar.mp4 asset as a
// real decodable "stem" so duration/seek actually work in Chromium. It does
// NOT verify audio wrap-around during real timed playback — the seek-back
// calculation itself is covered by the `getLoopSeekTarget` unit test in
// src/features/player/lib/ab-loop.test.ts.

const SONG_ID = '0b59abe8-4eac-4245-8cc1-2bceea4a3368'

const CHORDS = Array.from({ length: 30 }, (_, index) => ({
  start_time: index * 2,
  end_time: index * 2 + 2,
  chord: index % 2 === 0 ? 'G' : 'C',
  bass: null,
}))
const LYRICS = Array.from({ length: 30 }, (_, index) => ({
  start: index * 2,
  end: index * 2 + 2,
  text: `line ${index + 1}`,
  words: [
    { word: 'line', start: index * 2, end: index * 2 + 1 },
    { word: String(index + 1), start: index * 2 + 1, end: index * 2 + 2 },
  ],
}))

const SONG_DETAIL = {
  song: {
    id: SONG_ID, youtube_id: 'abc123', title: 'Knockin', artist: 'Dylan', duration_seconds: 180,
    song_name: 'dylan/knockin', thumbnail_key: null, thumbnail_url: null, audio_key: null,
  },
  thumbnail_url: null, audio_url: null,
  // Actual URL is irrelevant in dev mode — the app always streams stems through
  // the backend's /stream endpoint (mocked below); this only needs to be truthy.
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

test.describe('A/B loop', () => {
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
    // Dev mode always streams stems through the backend's /stream endpoint —
    // serve a real short media file so the audio element loads real metadata.
    // Accept-Ranges is required or Chromium treats the resource as non-seekable
    // (audio.seekable stays [0,0] even once the file is fully buffered).
    await page.route(`**/api/v1/songs/${SONG_ID}/stream*`, (route) =>
      route.fulfill({ path: FAKE_STEM_FILE, contentType: 'video/mp4', headers: { 'Accept-Ranges': 'bytes' } }),
    )
  })

  test('start over returns playback and the song sheet to the beginning', async ({ authenticatedPage: page }) => {
    await page.goto(`/songs/${SONG_ID}`)
    await waitForDuration(page)

    await page.getByTestId('count-in-toggle').click()
    await page.getByTestId('player-play-button').click()

    const restartButton = page.getByTestId('player-restart')
    const progressBar = page.getByTestId('transport-progress-bar')
    await expect(restartButton).toBeVisible()
    await progressBar.click({ position: { x: 100, y: 4 } })
    await expect(progressBar).not.toHaveAttribute('aria-valuenow', '0')

    const chordSheet = page.getByTestId('chord-sheet')
    await chordSheet.evaluate((element) => element.scrollTo({ top: element.scrollHeight }))
    await expect.poll(() => chordSheet.evaluate((element) => element.scrollTop)).toBeGreaterThan(0)

    await restartButton.click()
    await expect(progressBar).toHaveAttribute('aria-valuenow', '0')
    await expect.poll(() => chordSheet.evaluate((element) => element.scrollTop)).toBe(0)
    await expect(page.getByTestId('player-play-button')).toHaveAttribute('aria-label', 'Pause')
  })

  test('tapping the loop button twice sets A and B markers on the progress bar', async ({ authenticatedPage: page }) => {
    await page.goto(`/songs/${SONG_ID}`)
    await waitForDuration(page)

    const loopButton = page.getByTestId('ab-loop-toggle')
    await expect(loopButton).toBeVisible()
    await expect(loopButton).toHaveAttribute('aria-pressed', 'false')

    await loopButton.click()
    await expect(page.getByTestId('transport-loop-marker-a')).toBeVisible()
    await expect(page.getByTestId('transport-loop-marker-b')).toHaveCount(0)
    await expect(loopButton).toHaveAttribute('aria-pressed', 'false')

    // Move the play head forward before setting B, via the progress bar.
    const progressBar = page.getByTestId('transport-progress-bar')
    await progressBar.click({ position: { x: 100, y: 4 } })

    await loopButton.click()
    await expect(page.getByTestId('transport-loop-marker-a')).toBeVisible()
    await expect(page.getByTestId('transport-loop-marker-b')).toBeVisible()
    await expect(page.getByTestId('transport-loop-range')).toBeVisible()
    await expect(loopButton).toHaveAttribute('aria-pressed', 'true')
  })

  test('a third tap clears the loop and its markers', async ({ authenticatedPage: page }) => {
    await page.goto(`/songs/${SONG_ID}`)
    await waitForDuration(page)

    const loopButton = page.getByTestId('ab-loop-toggle')
    const progressBar = page.getByTestId('transport-progress-bar')

    await loopButton.click()
    await progressBar.click({ position: { x: 100, y: 4 } })
    await loopButton.click()
    await expect(loopButton).toHaveAttribute('aria-pressed', 'true')

    await loopButton.click()
    await expect(loopButton).toHaveAttribute('aria-pressed', 'false')
    await expect(page.getByTestId('transport-loop-marker-a')).toHaveCount(0)
    await expect(page.getByTestId('transport-loop-marker-b')).toHaveCount(0)
  })

  test('setting B before A on the timeline swaps the markers into order', async ({ authenticatedPage: page }) => {
    await page.goto(`/songs/${SONG_ID}`)
    await waitForDuration(page)

    const loopButton = page.getByTestId('ab-loop-toggle')
    const progressBar = page.getByTestId('transport-progress-bar')

    // Set A further along the timeline first...
    await progressBar.click({ position: { x: 200, y: 4 } })
    await loopButton.click()
    const markerABox = await page.getByTestId('transport-loop-marker-a').boundingBox()

    // ...then set B earlier than A.
    await progressBar.click({ position: { x: 50, y: 4 } })
    await loopButton.click()
    const markerAAfterSwap = await page.getByTestId('transport-loop-marker-a').boundingBox()
    const markerBAfterSwap = await page.getByTestId('transport-loop-marker-b').boundingBox()

    expect(markerABox).not.toBeNull()
    expect(markerAAfterSwap).not.toBeNull()
    expect(markerBAfterSwap).not.toBeNull()
    // After the swap, A (the earlier point) must sit to the left of B.
    expect(markerAAfterSwap!.x).toBeLessThan(markerBAfterSwap!.x)
  })
})

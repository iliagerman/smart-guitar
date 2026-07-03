import type { Page } from '@playwright/test'
import { test, expect } from '../fixtures/auth'

// Real, short, statically-served media file used as a stand-in "stem" so the
// audio element actually loads metadata (duration) and can be played/seeked.
// It is 16s long — the fixture lyrics below are timed to fit inside that.
const FAKE_STEM_FILE = new URL('../../../public/guitar.mp4', import.meta.url).pathname

async function waitForDuration(page: Page) {
  await expect(page.getByTestId('transport-duration')).not.toHaveText('0:00', { timeout: 10000 })
}

// NOTE: This drives real (paused/playing) HTMLAudio via the app's own static
// /guitar.mp4 asset, same approach as ab-loop.spec.ts and
// keyboard-shortcuts.spec.ts. The gap-detection math itself (grace period,
// pre-roll clamp, no-thrash landing point, suppression of a scrubbed-into
// gap) is covered by the `instrumental-gaps.test.ts` unit tests; this spec
// only verifies the enforcement loop actually seeks (or doesn't) during real
// playback and that the UI toggle/visibility rules behave correctly.

const SONG_ID = 'c9d8e7f6-4eac-4245-8cc1-2bceea4a3368'

const CHORDS = [{ start_time: 0, end_time: 2, chord: 'G', bass: null }]

type LyricLine = { start: number; end: number; text: string; words: { word: string; start: number; end: number }[] }

function line(start: number, end: number): LyricLine {
  return { start, end, text: 'la', words: [{ word: 'la', start, end }] }
}

// Sung segments: 0-1s, 6-7s, 15-16s.
// Gap 1 (1s -> 6s) is 5s long — must NOT be skipped.
// Gap 2 (7s -> 15s) is 8s long — must be skipped (target: 15 - 1.5 = 13.5s).
const LYRICS = [line(0, 1), line(6, 7), line(15, 16)]

// A single 8s gap (1s -> 9s) reached by playing straight through from 0 —
// used to prove a *naturally entered* gap is still skipped even though a
// deliberately scrubbed-into gap now gets suppressed (see below).
const LYRICS_NATURAL_ENTRY = [line(0, 1), line(9, 10)]

function buildChordOption(overrides: Record<string, unknown> = {}, lyrics: LyricLine[] = LYRICS) {
  return {
    name: 'Detected', description: 'Auto-detected chords', capo: 0, hidden: false, is_variant: false,
    version_key: null, created_by: null, vote_score: 0, lyrics_source: 'detected', chords: CHORDS, lyrics,
    ...overrides,
  }
}

const UNSYNCED_COMMUNITY_OPTION = buildChordOption({
  name: 'Sheet 1', description: 'Community chord sheet', version_key: 'community:sheet1',
  lyrics_source: 'community', lyrics_synced: false,
})

function buildSongDetail(chordOptions: unknown[], lyrics: LyricLine[] = LYRICS) {
  return {
    song: {
      id: SONG_ID, youtube_id: 'abc123', title: 'Knockin', artist: 'Dylan', duration_seconds: 180,
      song_name: 'dylan/knockin', thumbnail_key: null, thumbnail_url: null, audio_key: null,
    },
    thumbnail_url: null, audio_url: null,
    stems: { guitar: 'processed' },
    stem_types: [{ name: 'guitar' }],
    chords: [], lyrics, lyrics_source: 'detected', quick_lyrics: [], quick_lyrics_source: null,
    corrected_lyrics: [], corrected_lyrics_source: null,
    chord_options: chordOptions,
    chord_source: 'autochord', recommended_capo: null, song_key: 'G',
    tabs: [], strums: [], rhythm: null, sections: [], active_job: null, download_pending: false,
  }
}

async function mockSongDetail(page: Page, chordOptions: unknown[], lyrics: LyricLine[] = LYRICS) {
  await page.route(`**/api/v1/songs/${SONG_ID}`, (route) =>
    route.request().method() === 'GET'
      ? route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(buildSongDetail(chordOptions, lyrics)),
        })
      : route.continue(),
  )
}

test.describe('Skip instrumentals', () => {
  test.beforeEach(async ({ authenticatedPage: page }) => {
    // Disable count-in so playback starts immediately on Space/play-click.
    // This init script re-runs on every navigation (including page.reload()),
    // so it merges into whatever is already persisted instead of overwriting
    // it wholesale — otherwise it would stomp on a skipInstrumentals toggle
    // the test made via the UI right before reloading.
    await page.addInitScript(() => {
      const existing = localStorage.getItem('player-prefs')
      const parsed = existing ? JSON.parse(existing) : { state: {}, version: 18 }
      parsed.state.countInEnabled = false
      localStorage.setItem('player-prefs', JSON.stringify(parsed))
    })
    await page.route('**/api/v1/favorites', (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ favorites: [] }) })
        : route.continue(),
    )
    await mockSongDetail(page, [buildChordOption(), UNSYNCED_COMMUNITY_OPTION])
    await page.route('**/api/v1/songs/*/play', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) }),
    )
    await page.route(`**/api/v1/songs/${SONG_ID}/stream*`, (route) =>
      route.fulfill({ path: FAKE_STEM_FILE, contentType: 'video/mp4', headers: { 'Accept-Ranges': 'bytes' } }),
    )
  })

  test('skips an instrumental gap entered naturally during playback', async ({ authenticatedPage: page }) => {
    // Override with a timeline where playing straight through from 0 crosses
    // into the gap on its own — no seek involved, so nothing suppresses it.
    await mockSongDetail(page, [buildChordOption({}, LYRICS_NATURAL_ENTRY)], LYRICS_NATURAL_ENTRY)

    await page.goto(`/songs/${SONG_ID}`)
    await waitForDuration(page)

    const toggle = page.getByTestId('player-skip-instrumentals-toggle')
    await expect(toggle).toHaveAttribute('aria-pressed', 'false')
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-pressed', 'true')

    await page.getByTestId('player-play-button').click()

    // Gap is 1s -> 9s; skip fires once past the 1s grace (~2s of real
    // playback) and lands at 9 - 1.5 = 7.5s. Natural playback from 0 would
    // only reach 7s after ~7 real seconds, so a tight window here proves a
    // jump rather than ordinary continued playback.
    const progressBar = page.getByTestId('transport-progress-bar')
    await expect(progressBar).toHaveAttribute('aria-valuetext', /0:0[78] of/, { timeout: 4000 })

    await expect(page.getByText('Skipped instrumental')).toBeVisible()
  })

  test('does not skip a gap that is only 5 seconds long', async ({ authenticatedPage: page }) => {
    await page.goto(`/songs/${SONG_ID}`)
    await waitForDuration(page)

    await page.getByTestId('player-skip-instrumentals-toggle').click()
    await page.getByTestId('player-play-button').click()

    const progressBar = page.getByTestId('transport-progress-bar')
    await progressBar.focus()
    // 0 -> 5: lands inside the 5s gap (1-6), which must never be skipped.
    await page.keyboard.press('ArrowRight')

    // Give the enforcement loop several frames to (not) act, then confirm
    // playback is still around the seek point instead of having jumped ahead.
    await expect(progressBar).toHaveAttribute('aria-valuetext', /0:0[56] of/, { timeout: 500 })
  })

  test('does not skip a gap the user has deliberately scrubbed into', async ({ authenticatedPage: page }) => {
    await page.goto(`/songs/${SONG_ID}`)
    await waitForDuration(page)

    await page.getByTestId('player-skip-instrumentals-toggle').click()
    await page.getByTestId('player-play-button').click()

    const progressBar = page.getByTestId('transport-progress-bar')
    await progressBar.focus()
    // 0 -> 5 -> 10: a manual seek landing inside the 8s gap (7-15), past the
    // grace period — this is a deliberate scrub, not a natural crossing, so
    // it must be suppressed from auto-skip.
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('ArrowRight')

    // Wait comfortably longer than the grace + pre-roll window that would
    // otherwise trigger a skip, and confirm playback stayed put instead of
    // jumping to the pre-roll landing point (~13.5s), with no toast either.
    await page.waitForTimeout(2000)
    await expect(progressBar).toHaveAttribute('aria-valuetext', /0:1[0-3] of/)
    await expect(page.getByText('Skipped instrumental')).not.toBeVisible()
  })

  test('toggle persists after reload', async ({ authenticatedPage: page }) => {
    await page.goto(`/songs/${SONG_ID}`)
    await waitForDuration(page)

    const toggle = page.getByTestId('player-skip-instrumentals-toggle')
    await expect(toggle).toHaveAttribute('aria-pressed', 'false')

    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-pressed', 'true')

    await page.reload()
    await waitForDuration(page)
    await expect(page.getByTestId('player-skip-instrumentals-toggle')).toHaveAttribute('aria-pressed', 'true')
  })

  test('toggle is disabled when the active sheet has unsynced lyrics', async ({ authenticatedPage: page }) => {
    await page.goto(`/songs/${SONG_ID}`)
    await waitForDuration(page)

    const toggle = page.getByTestId('player-skip-instrumentals-toggle')
    await expect(toggle).toBeEnabled()

    await page.getByTestId('sheet-selector-trigger').click()
    await page.getByTestId('sheet-selector-source-1').click()

    await expect(toggle).toBeDisabled()
    await expect(toggle).toHaveAttribute('title', /synced lyrics/)
  })
})

import type { Page } from '@playwright/test'
import { test, expect } from '../fixtures/auth'

const SONG_ID = '00000000-0000-4000-8000-000000000002'
const chords = [
  { start_time: 0.5, end_time: 4.7, chord: 'G', bass: null },
  { start_time: 4.7, end_time: 8.9, chord: 'C', bass: null },
]
const lyrics = [{ start: 0.5, end: 8.9, text: 'Synthetic metronome fixture', words: [
  { word: 'Synthetic', start: 0.5, end: 3 },
  { word: 'metronome', start: 3, end: 6 },
  { word: 'fixture', start: 6, end: 8.9 },
] }]

function songDetail(rhythmFields: Record<string, unknown>) {
  return {
    song: { id: SONG_ID, youtube_id: 'synthetic', title: 'Metronome fixture', artist: 'Test', duration_seconds: 9, song_name: 'test/metronome', thumbnail_key: null, thumbnail_url: null, audio_key: null },
    thumbnail_url: null, audio_url: null,
    stems: { guitar: 'http://127.0.0.1:5187/fake-guitar.mp3' }, stem_types: [{ name: 'guitar' }],
    chords, lyrics, lyrics_source: 'detected', quick_lyrics: [], corrected_lyrics: [],
    chord_options: [{ name: 'Detected', description: 'Synthetic chords', capo: 0, hidden: false, is_variant: false, chords, lyrics, lyrics_source: 'detected' }],
    chord_source: 'autochord', song_key: 'G', tabs: [], strums: [], rhythm: null, sections: [], active_job: null, download_pending: false,
    ...rhythmFields,
  }
}

async function mockSong(page: Page, rhythmFields: Record<string, unknown>) {
  // Context routing is the network boundary; page-level API mocks take priority.
  await page.context().route('**/*', async (route) => {
    const url = new URL(route.request().url())
    if (url.origin !== 'http://127.0.0.1:5187') return route.abort()
    if (url.pathname.startsWith('/api/')) return route.fulfill({ json: {} })
    if (url.pathname === '/fake-guitar.mp3') return route.fulfill({ body: '', contentType: 'audio/mpeg' })
    return route.fulfill({ response: await route.fetch() })
  })
  await page.route('**/api/v1/favorites', (route) => route.fulfill({ json: { favorites: [] } }))
  await page.route(`**/api/v1/songs/${SONG_ID}`, (route) => route.fulfill({ json: songDetail(rhythmFields) }))
  await page.goto(`/songs/${SONG_ID}`)
}

async function openSongMetronome(page: Page, rhythmFields: Record<string, unknown>) {
  await mockSong(page, rhythmFields)
  await page.getByTestId('song-metronome-toggle').click()
  await expect(page.getByTestId('metronome-panel')).toBeVisible()
}

test('song metronome takes its tempo from the beats detected in the recording', async ({ authenticatedPage: page }) => {
  // The backend measured 114 BPM in the audio; the tab is notated at 116.
  await openSongMetronome(page, {
    beat_times: [0.5, 1.025, 1.55, 2.075, 2.6, 3.125, 3.65, 4.175, 4.7],
    bar_starts: [0.5, 2.6, 4.7],
    detected_bpm: 114.29,
    source_bpm: 116,
    time_signature: [4, 4],
  })
  await expect(page.getByTestId('metronome-bpm')).toHaveText('114')
  await expect(page.getByTestId('metronome-beats-per-bar')).toHaveValue('4')
})

test('song metronome uses the tab tempo and meter when no beats were detected', async ({ authenticatedPage: page }) => {
  await openSongMetronome(page, { source_bpm: 96, time_signature: [3, 4] })
  await expect(page.getByTestId('metronome-bpm')).toHaveText('96')
  await expect(page.getByTestId('metronome-beats-per-bar')).toHaveValue('3')
  await expect(page.getByTestId('metronome-beat-unit')).toHaveValue('4')
  await expect(page.locator('[data-testid^="metronome-beat-"][data-accented]')).toHaveCount(3)
})

test('bars view shows the song meter and detected tempo', async ({ authenticatedPage: page }) => {
  await mockSong(page, {
    beat_times: [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5],
    bar_starts: [0.5, 2, 3.5, 5],
    detected_bpm: 120,
    source_bpm: 120,
    time_signature: [3, 4],
  })
  await page.getByTestId('sheet-selector-trigger').click()
  await page.getByTestId('sheet-selector-view-bars').click()
  await expect(page.getByTestId('bars-sheet-tempo')).toHaveText('120 BPM · 3/4')
})

// From the tab: D . D U . U D U with the snare on 2 and 4.
const tabRhythm = {
  beats_per_bar: 4,
  beat_accents: [0, 0.93, 0, 0.85],
  strum_patterns: [{
    name: 'Verse',
    subdivision: 2,
    bar_share: 0.8,
    steps: ['down', 'miss', 'down', 'up', 'miss', 'up', 'down', 'up'].map((direction, index) => ({
      direction, accent: index === 2 || index === 6,
    })),
  }],
}
const syncedBeats = {
  beat_times: [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5],
  bar_starts: [0.5, 2.5, 4.5],
  detected_bpm: 120,
  time_signature: [4, 4],
}

test('song metronome accents the beats the tab puts the snare on', async ({ authenticatedPage: page }) => {
  await openSongMetronome(page, { ...syncedBeats, tab_rhythm: tabRhythm })
  await expect(page.getByTestId('metronome-beat-0')).toHaveAttribute('data-emphasis', 'downbeat')
  await expect(page.getByTestId('metronome-beat-1')).toHaveAttribute('data-emphasis', 'accent')
  await expect(page.getByTestId('metronome-beat-2')).toHaveAttribute('data-emphasis', 'normal')
  await expect(page.getByTestId('metronome-beat-3')).toHaveAttribute('data-emphasis', 'accent')
})

test('song metronome only accents beat 1 when the song has no measured emphasis', async ({ authenticatedPage: page }) => {
  await openSongMetronome(page, syncedBeats)
  await expect(page.getByTestId('metronome-beat-0')).toHaveAttribute('data-emphasis', 'downbeat')
  await expect(page.locator('[data-testid^="metronome-beat-"][data-emphasis="accent"]')).toHaveCount(0)
})

async function openStrumCard(page: Page) {
  // Phones show the chord map (with the strum card) in a dialog.
  if (test.info().project.name === 'mobile') await page.getByTestId('chord-map-open-button').click()
  return page.locator('[data-testid="strum-pattern-card"]:visible')
}

test('strumming pattern shows the tab pattern with its snare accents', async ({ authenticatedPage: page }) => {
  await mockSong(page, {
    ...syncedBeats,
    tab_rhythm: tabRhythm,
    songsterr_status: 'ready',
    sections: [{ name: 'Verse', start_time: 0, end_time: 9, strum_pattern: ['down', 'down', 'up', 'up', 'down', 'up'], llm_pattern: null }],
  })
  const card = await openStrumCard(page)
  await expect(card.getByTestId('strum-section-name')).toHaveText(['Verse'])
  await expect(card.getByTestId('strum-bar-share')).toHaveText('80% of bars')
  const steps = card.getByTestId('strum-step')
  await expect(steps).toHaveCount(8)
  await expect(steps.nth(1)).toHaveAttribute('data-direction', 'miss')
  await expect(steps.nth(2)).toHaveAttribute('data-accent', 'true')
  await expect(steps.nth(3)).toHaveAttribute('data-accent', 'false')
  await expect(steps.nth(6)).toHaveAttribute('data-accent', 'true')
  await expect(card.getByTestId('strum-step-label').nth(1)).toHaveText('&')
})

test('tutorial-site strum guesses are not shown without a tab pattern', async ({ authenticatedPage: page }) => {
  await mockSong(page, {
    ...syncedBeats,
    songsterr_status: 'ready',
    tutorial_url: 'https://www.youtube.com/watch?v=synthetic',
    tutorial_links: [{ url: 'https://www.youtube.com/watch?v=synthetic', title: 'Synthetic lesson' }],
    sections: [{ name: 'Verse', start_time: 0, end_time: 9, strum_pattern: ['down', 'down', 'up', 'up', 'down', 'up'], llm_pattern: ['down', 'down', 'up', 'up', 'down', 'up'] }],
  })
  const card = await openStrumCard(page)
  await expect(card.getByTestId('strum-tutorial-button')).toBeVisible()
  // A count of zero passes at once; let the page finish loading so the check is real.
  await page.waitForLoadState('networkidle')
  await expect(card.getByTestId('strum-step')).toHaveCount(0)
})

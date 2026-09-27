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

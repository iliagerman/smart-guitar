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
    return route.fallback()
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

test('without a tab pattern the card offers the starter pattern, not tutorial-site guesses', async ({ authenticatedPage: page }) => {
  await mockSong(page, {
    ...syncedBeats,
    songsterr_status: 'ready',
    tutorial_url: 'https://www.youtube.com/watch?v=synthetic',
    tutorial_links: [{ url: 'https://www.youtube.com/watch?v=synthetic', title: 'Synthetic lesson' }],
    sections: [{ name: 'Verse', start_time: 0, end_time: 9, strum_pattern: ['down', 'down', 'up', 'up', 'down', 'up'], llm_pattern: ['down', 'down', 'up', 'up', 'down', 'up'] }],
  })
  const card = await openStrumCard(page)
  await expect(card.getByTestId('strum-tutorial-button')).toBeVisible()
  // The guess is D D U U D U; the starter is D · D U · U D U, labelled as a starter.
  await expect(card.getByTestId('strum-starter')).toBeVisible()
  await expect(card.getByTestId('strum-section-name')).toHaveText(['Starter pattern'])
  const steps = card.getByTestId('strum-step')
  await expect(steps).toHaveCount(8)
  await expect(steps.nth(1)).toHaveAttribute('data-direction', 'miss')
  await expect(steps.nth(4)).toHaveAttribute('data-direction', 'miss')
})

test('the strum strip above the chords shows the pattern of the section being played', async ({ authenticatedPage: page }) => {
  // The tab plays the verse one way (most bars) and the chorus another; the song opens on the chorus.
  const chorusSteps = ['down', 'down', 'down', 'down'].map((direction) => ({ direction, accent: false }))
  await mockSong(page, {
    ...syncedBeats,
    songsterr_status: 'ready',
    tab_rhythm: {
      ...tabRhythm,
      strum_patterns: [...tabRhythm.strum_patterns, { name: 'Intro / Chorus', subdivision: 1, bar_share: 0.5, steps: chorusSteps }],
    },
    sections: [
      { name: 'Chorus 1', start_time: 0, end_time: 9, strum_pattern: [], llm_pattern: null },
      { name: 'Verse 1', start_time: 9, end_time: 18, strum_pattern: [], llm_pattern: null },
    ],
  })
  // Shown on every screen size, not only where the chord map is hidden.
  const strip = page.getByTestId('strum-strip')
  await expect(strip).toBeVisible()
  await expect(strip.getByTestId('strum-strip-section')).toHaveText('Chorus')
  await expect(strip.getByTestId('strum-strip-step')).toHaveCount(4)
})

test('chord sheet marks each bar and fills it with exactly one bar of chords', async ({ authenticatedPage: page }) => {
  // 0.5 s beats, bars at 0.5 and 2.5 s. C is played across the bar line, so it shows again in bar 2.
  const barChords = [
    { start_time: 0.5, end_time: 1.5, chord: 'G', bass: null },
    { start_time: 1.5, end_time: 3.5, chord: 'C', bass: null },
    { start_time: 3.5, end_time: 4.5, chord: 'D', bass: null },
  ]
  const barLyrics = [{ start: 0.5, end: 4.5, text: 'Synthetic bars fixture', words: [
    { word: 'Synthetic', start: 0.5, end: 2 },
    { word: 'bars', start: 2, end: 3.5 },
    { word: 'fixture', start: 3.5, end: 4.5 },
  ] }]
  await mockSong(page, {
    ...syncedBeats,
    chords: barChords,
    lyrics: barLyrics,
    chord_options: [{ name: 'Detected', description: 'Synthetic chords', capo: 0, hidden: false, is_variant: false, chords: barChords, lyrics: barLyrics, lyrics_source: 'detected' }],
  })
  const sheet = page.getByTestId('chord-sheet')
  await expect(sheet.locator('[data-chord-index]')).toHaveCount(4)
  // Two beats each, drawn as one block per beat.
  await expect(sheet.getByTestId('chord-hold')).toHaveCount(4)
  for (const hold of await sheet.getByTestId('chord-hold').all()) {
    await expect(hold).toHaveAttribute('data-beats', '2')
    await expect(hold.locator('span')).toHaveCount(2)
  }
  await expect(sheet.getByTestId('bar-line')).toHaveCount(2)
  await expect(sheet.locator('[data-chord-index]').nth(2)).toHaveAttribute('title', 'Keep holding for ½ bar')
})

test('the chord being played shows its played and its remaining beats', async ({ authenticatedPage: page }) => {
  // 0.5 s beats; the C holds two of them (1.5-2.5 s).
  const holdChords = [
    { start_time: 0.5, end_time: 1.5, chord: 'G', bass: null },
    { start_time: 1.5, end_time: 2.5, chord: 'C', bass: null },
    { start_time: 2.5, end_time: 4.5, chord: 'D', bass: null },
  ]
  // No count-in, so playback starts on the click.
  await page.addInitScript(() => {
    localStorage.setItem('player-prefs', JSON.stringify({ state: { countInEnabled: false }, version: 20 }))
  })
  // A real short media file, so the player has a duration and seeking moves the playhead.
  const media = new URL('../../../public/guitar.mp4', import.meta.url).pathname
  await page.route(`**/api/v1/songs/${SONG_ID}/stream*`, (route) =>
    route.fulfill({ path: media, contentType: 'video/mp4', headers: { 'Accept-Ranges': 'bytes' } }),
  )
  await mockSong(page, {
    ...syncedBeats,
    audio_url: 'synthetic',
    chords: holdChords,
    chord_options: [{ name: 'Detected', description: 'Synthetic chords', capo: 0, hidden: false, is_variant: false, chords: holdChords, lyrics: [], lyrics_source: 'detected' }],
  })
  await expect(page.getByTestId('transport-duration')).not.toHaveText('0:00', { timeout: 10000 })
  const sheet = page.getByTestId('chord-sheet')
  // Move the playhead to the C: it sits on its first beat.
  await sheet.locator('[data-chord-index]').nth(1).click()
  await page.getByRole('button', { name: 'Play from here' }).click()
  const blocks = sheet.locator('[data-chord-index]').nth(1).getByTestId('chord-hold').locator('span')
  await expect(blocks).toHaveCount(2)
  await expect(blocks.nth(0)).toHaveAttribute('data-played', 'true')
  await expect(blocks.nth(1)).toHaveAttribute('data-played', 'false')
})

test('a strum pattern wider than the strip keeps the stroke being played in view', async ({ authenticatedPage: page }) => {
  // Sixteen strokes a bar don't fit a phone's strip: it scrolls along as the song plays.
  const sixteenths = { name: 'Verse', subdivision: 4, bar_share: 0.8, steps: Array.from({ length: 16 }, (_, i) => ({ direction: i % 2 ? 'up' : 'down', accent: false })) }
  await page.addInitScript(() => {
    localStorage.setItem('player-prefs', JSON.stringify({ state: { countInEnabled: false }, version: 20 }))
  })
  const media = new URL('../../../public/guitar.mp4', import.meta.url).pathname
  await page.route(`**/api/v1/songs/${SONG_ID}/stream*`, (route) =>
    route.fulfill({ path: media, contentType: 'video/mp4', headers: { 'Accept-Ranges': 'bytes' } }),
  )
  await mockSong(page, { ...syncedBeats, audio_url: 'synthetic', songsterr_status: 'ready', tab_rhythm: { ...tabRhythm, strum_patterns: [sixteenths] } })
  await expect(page.getByTestId('transport-duration')).not.toHaveText('0:00', { timeout: 10000 })
  const strip = page.getByTestId('strum-strip')
  await expect(strip.getByTestId('strum-strip-step')).toHaveCount(16)
  const narrow = (page.viewportSize()?.width ?? 1000) < 500
  // Copies of the pattern on either side make the loop; only where it overflows.
  await expect(strip.getByTestId('strum-strip-step-copy')).toHaveCount(narrow ? 32 : 0)

  await page.getByRole('button', { name: 'Play', exact: true }).locator('visible=true').first().click()
  const list = strip.locator('ol')
  await expect.poll(async () => {
    const on = strip.locator('[data-testid="strum-strip-step"][data-on="true"]')
    if (await on.count() === 0) return 'not playing yet'
    const [box, view] = [await on.boundingBox(), await list.boundingBox()]
    return box && view && box.x >= view.x - 1 && box.x + box.width <= view.x + view.width + 1 ? 'in view' : 'out of view'
  }, { timeout: 10000 }).toBe('in view')
})

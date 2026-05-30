import { test, expect } from '../fixtures/auth'

const SONG_ID = '0b59abe8-4eac-4245-8cc1-2bceea4a3368'

const SONG_DETAIL = {
  song: {
    id: SONG_ID,
    youtube_id: 'abc123',
    title: 'Knocking on Heavens Door',
    artist: 'Bob Dylan',
    duration_seconds: 180,
    song_name: 'bob_dylan/knocking_on_heavens_door',
    thumbnail_key: null,
    thumbnail_url: null,
    audio_key: null,
  },
  thumbnail_url: null,
  audio_url: null,
  // Processed stems so the chord sheet renders.
  stems: { guitar: 'http://localhost:5173/fake-guitar.mp3' },
  stem_types: [{ name: 'guitar' }],
  chords: [],
  lyrics: [
    {
      start: 0,
      end: 6,
      text: 'mama take this badge off of me',
      words: [
        { word: 'mama', start: 0, end: 2 },
        { word: 'take', start: 2, end: 4 },
        { word: 'this', start: 4, end: 6 },
      ],
    },
  ],
  lyrics_source: 'detected',
  quick_lyrics: [],
  quick_lyrics_source: null,
  corrected_lyrics: [],
  corrected_lyrics_source: null,
  // Detected chord option drives the chord sheet (see buildSheetVersions).
  chord_options: [
    {
      name: 'Detected',
      description: 'Auto-detected chords',
      capo: 0,
      hidden: false,
      is_variant: false,
      version_key: null,
      created_by: null,
      vote_score: 0,
      lyrics_source: 'detected',
      chords: [
        { start_time: 0, end_time: 2, chord: 'G', bass: null },
        { start_time: 2, end_time: 4, chord: 'D', bass: null },
        { start_time: 4, end_time: 6, chord: 'C', bass: null },
      ],
      lyrics: [
        {
          start: 0,
          end: 6,
          text: 'mama take this badge off of me',
          words: [
            { word: 'mama', start: 0, end: 2 },
            { word: 'take', start: 2, end: 4 },
            { word: 'this', start: 4, end: 6 },
          ],
        },
      ],
    },
  ],
  chord_source: 'autochord',
  recommended_capo: null,
  song_key: 'G',
  tabs: [],
  strums: [],
  rhythm: null,
  sections: [],
  active_job: null,
  download_pending: false,
}

test.describe('Chord voicing browser', () => {
  test.beforeEach(async ({ authenticatedPage: page }) => {
    await page.route('**/api/v1/favorites', async (route) => {
      if (route.request().method() !== 'GET') return route.continue()
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ favorites: [] }),
      })
    })

    await page.route(`**/api/v1/songs/${SONG_ID}`, async (route) => {
      if (route.request().method() !== 'GET') return route.continue()
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(SONG_DETAIL),
      })
    })
  })

  test('tapping a chord opens its fingering diagram', async ({ authenticatedPage: page }) => {
    await page.goto(`/songs/${SONG_ID}`)

    const chordSheet = page.getByTestId('chord-sheet')
    await expect(chordSheet).toBeVisible()

    // Tap the first chord (G).
    await chordSheet.getByRole('button', { name: 'G' }).first().click()

    const popover = page.getByTestId('chord-voicing-popover')
    await expect(popover).toBeVisible()
    await expect(page.getByTestId('chord-voicing-name')).toHaveText('G')
    // The diagram (or its loading spinner) is shown, plus the seek action.
    await expect(page.getByTestId('chord-voicing-play')).toBeVisible()
  })

  test('browsing cycles through alternate voicings', async ({ authenticatedPage: page }) => {
    await page.goto(`/songs/${SONG_ID}`)

    const chordSheet = page.getByTestId('chord-sheet')
    await expect(chordSheet).toBeVisible()
    await chordSheet.getByRole('button', { name: 'C' }).first().click()

    await expect(page.getByTestId('chord-voicing-popover')).toBeVisible()

    // C has several curated voicings; the counter should advance on "next".
    const counter = page.getByTestId('chord-voicing-counter')
    await expect(counter).toBeVisible()
    await expect(counter).toHaveText(/^1\/\d+$/)

    await page.getByTestId('chord-voicing-next').click()
    await expect(counter).toHaveText(/^2\/\d+$/)
  })

  test('"Play from here" closes the popover', async ({ authenticatedPage: page }) => {
    await page.goto(`/songs/${SONG_ID}`)

    const chordSheet = page.getByTestId('chord-sheet')
    await expect(chordSheet).toBeVisible()
    await chordSheet.getByRole('button', { name: 'D' }).first().click()

    await expect(page.getByTestId('chord-voicing-popover')).toBeVisible()
    await page.getByTestId('chord-voicing-play').click()
    await expect(page.getByTestId('chord-voicing-popover')).not.toBeVisible()
  })

  // On mobile there is no current-chord sidebar, so the popover is the only way to
  // see a fingering during playback — it must open and stay within the viewport.
  test('popover opens and fits the viewport on mobile', async ({ authenticatedPage: page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(`/songs/${SONG_ID}`)

    const chordSheet = page.getByTestId('chord-sheet')
    await expect(chordSheet).toBeVisible()
    await chordSheet.getByRole('button', { name: 'C' }).first().click()

    const popover = page.getByTestId('chord-voicing-popover')
    await expect(popover).toBeVisible()
    await expect(page.getByTestId('chord-voicing-play')).toBeVisible()

    const box = await popover.boundingBox()
    const viewport = page.viewportSize()!
    expect(box).not.toBeNull()
    expect(box!.x).toBeGreaterThanOrEqual(0)
    expect(box!.y).toBeGreaterThanOrEqual(0)
    expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width)
    expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height)
  })
})

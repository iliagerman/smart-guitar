import { test, expect } from '../fixtures/auth'

const SONG_ID = 'c3d4e5f6-4eac-4245-8cc1-2bceea4a3370'
const USER_EMAIL = 'test@example.com'

const CHORDS = [{ start_time: 0, end_time: 2, chord: 'G', bass: null }]
const LYRICS = [
  { start: 0, end: 2, text: 'la', words: [{ word: 'la', start: 0, end: 2 }] },
]

function buildSongDetail() {
  return {
    song: {
      id: SONG_ID, youtube_id: 'abc123', title: 'Knockin', artist: 'Dylan', duration_seconds: 180,
      song_name: 'dylan/knockin', thumbnail_key: null, thumbnail_url: null, audio_key: null,
    },
    thumbnail_url: null, audio_url: null,
    stems: { guitar: 'processed' },
    stem_types: [{ name: 'guitar' }],
    chords: [], lyrics: LYRICS, lyrics_source: 'detected', quick_lyrics: [], quick_lyrics_source: null,
    corrected_lyrics: [], corrected_lyrics_source: null,
    chord_options: [
      {
        name: 'Detected', description: 'Auto-detected chords', capo: 0, hidden: false, is_variant: false,
        version_key: null, created_by: null, vote_score: 0, lyrics_source: 'detected', chords: CHORDS, lyrics: LYRICS,
      },
      {
        name: 'My version', description: 'Custom chords', capo: 0, hidden: false, is_variant: false,
        version_key: 'user', created_by: USER_EMAIL, vote_score: 0, lyrics_source: 'detected', chords: CHORDS, lyrics: LYRICS,
      },
    ],
    chord_source: 'autochord', recommended_capo: null, song_key: 'G',
    tabs: [], strums: [], rhythm: null, sections: [], active_job: null, download_pending: false,
  }
}

test.describe('Deleting a custom chord version', () => {
  test.beforeEach(async ({ authenticatedPage: page }) => {
    await page.route('**/api/v1/favorites', (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ favorites: [] }) })
        : route.continue(),
    )
    await page.route(`**/api/v1/songs/${SONG_ID}`, (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(buildSongDetail()) })
        : route.continue(),
    )
    await page.route('**/api/v1/songs/*/play', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) }),
    )
    await page.route(`**/api/v1/songs/${SONG_ID}/stream*`, (route) =>
      route.fulfill({ status: 404 }),
    )
  })

  test('shows a confirm dialog instead of the native confirm, and cancelling keeps the version', async ({ authenticatedPage: page }) => {
    let deleteCalled = false
    await page.route(`**/api/v1/songs/${SONG_ID}/chords`, (route) => {
      if (route.request().method() === 'DELETE') deleteCalled = true
      return route.continue()
    })

    await page.goto(`/songs/${SONG_ID}`)
    await page.getByTestId('sheet-selector-trigger').click()
    await page.getByTestId('sheet-selector-source-1').click()
    await page.getByTestId('sheet-selector-trigger').click()
    await page.getByTestId('sheet-selector-delete-button').click()

    const dialog = page.getByTestId('confirm-dialog')
    await expect(dialog).toBeVisible()

    await page.getByTestId('confirm-dialog-cancel-button').click()
    await expect(dialog).toHaveCount(0)
    expect(deleteCalled).toBe(false)
  })

  test('confirming the dialog deletes the chord version', async ({ authenticatedPage: page }) => {
    await page.route(`**/api/v1/songs/${SONG_ID}/chords`, (route) =>
      route.request().method() === 'DELETE'
        ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(buildSongDetail()) })
        : route.continue(),
    )

    await page.goto(`/songs/${SONG_ID}`)
    await page.getByTestId('sheet-selector-trigger').click()
    await page.getByTestId('sheet-selector-source-1').click()
    await page.getByTestId('sheet-selector-trigger').click()
    await page.getByTestId('sheet-selector-delete-button').click()

    await page.getByTestId('confirm-dialog-confirm-button').click()
    await expect(page.getByText(/chord version deleted/i)).toBeVisible()
  })
})

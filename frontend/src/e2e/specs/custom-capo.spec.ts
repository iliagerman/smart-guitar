import { test, expect } from '../fixtures/auth'

const SONG_ID = '00000000-0000-4000-8000-000000000001'
const chords = [
  { start_time: 0, end_time: 2, chord: 'G', bass: 'D' },
  { start_time: 2, end_time: 4, chord: 'D', bass: null },
  { start_time: 4, end_time: 6, chord: 'C', bass: null },
]
const lyrics = [{ start: 0, end: 6, text: 'Synthetic capo fixture', words: [
  { word: 'Synthetic', start: 0, end: 2 },
  { word: 'capo', start: 2, end: 4 },
  { word: 'fixture', start: 4, end: 6 },
] }]

test('custom capo transposes shapes, persists, and restores no capo', async ({ authenticatedPage: page }) => {
  // Context routing is the network boundary; page-level API mocks take priority.
  await page.context().route('**/*', async (route) => {
    const url = new URL(route.request().url())
    if (url.origin !== 'http://127.0.0.1:5187') return route.abort()
    if (url.pathname.startsWith('/api/')) return route.fulfill({ json: {} })
    if (url.pathname === '/fake-guitar.mp3') return route.fulfill({ body: '', contentType: 'audio/mpeg' })
    return route.fulfill({ response: await route.fetch() })
  })
  await page.route('**/api/v1/favorites', (route) => route.fulfill({ json: { favorites: [] } }))
  await page.route(`**/api/v1/songs/${SONG_ID}`, (route) => route.fulfill({ json: {
    song: { id: SONG_ID, youtube_id: 'synthetic', title: 'Capo fixture', artist: 'Test', duration_seconds: 6, song_name: 'test/capo', thumbnail_key: null, thumbnail_url: null, audio_key: null },
    thumbnail_url: null, audio_url: null,
    stems: { guitar: 'http://127.0.0.1:5187/fake-guitar.mp3' }, stem_types: [{ name: 'guitar' }],
    chords, lyrics, lyrics_source: 'detected', quick_lyrics: [], corrected_lyrics: [],
    chord_options: [{ name: 'Detected', description: 'Synthetic chords', capo: 0, hidden: false, is_variant: false, chords, lyrics, lyrics_source: 'detected' }],
    chord_source: 'autochord', song_key: 'G', tabs: [], strums: [], rhythm: null, sections: [], active_job: null, download_pending: false,
  } }))
  await page.goto(`/songs/${SONG_ID}`)
  const sheet = page.getByTestId('chord-sheet')
  const trigger = page.getByTestId('sheet-selector-trigger')
  await expect(sheet).toBeVisible()
  await expect(sheet.getByRole('button', { name: 'G/D', exact: true })).toBeVisible()

  await trigger.click()
  const fret = page.getByRole('combobox', { name: 'Custom capo fret' })
  await expect(fret.locator('option')).toHaveCount(14)
  await fret.selectOption('capo-8') // Outside the automatic suggestion range.
  await expect(trigger).toContainText('Capo 8')
  await expect(sheet.getByRole('button', { name: 'B/F#', exact: true })).toBeVisible()
  await expect(sheet.getByRole('button', { name: 'F#', exact: true })).toBeVisible()
  await expect(sheet.getByRole('button', { name: 'E', exact: true })).toBeVisible()
  await sheet.getByRole('button', { name: 'E', exact: true }).click()
  await expect(page.getByTestId('chord-voicing-name')).toHaveText('E')
  await page.keyboard.press('Escape')

  await page.reload()
  await expect(trigger).toContainText('Capo 8')
  await expect(sheet.getByRole('button', { name: 'B/F#', exact: true })).toBeVisible()
  await trigger.click()
  await expect(fret).toHaveValue('capo-8')
  await fret.selectOption('capo-12')
  await expect(trigger).toContainText('Capo 12')
  await expect(sheet.getByRole('button', { name: 'G/D', exact: true })).toBeVisible()

  await trigger.click()
  const suggested = page.getByTestId('sheet-selector-popover').locator('button[data-testid^="sheet-selector-view-capo-"]').first()
  await expect(suggested).toBeVisible()
  const suggestedLabel = await suggested.innerText()
  await suggested.click()
  await expect(trigger).toContainText(suggestedLabel.trim())

  await trigger.click()
  await fret.selectOption('capo-0')
  await expect(sheet.getByRole('button', { name: 'G/D', exact: true })).toBeVisible()
  await expect(sheet.getByRole('button', { name: 'D', exact: true })).toBeVisible()
  await trigger.click()
  await page.getByTestId('sheet-selector-view-standard').click()
  await expect(trigger).toContainText('Chords')
})

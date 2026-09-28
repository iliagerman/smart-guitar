import { test, expect } from '../fixtures/auth'
import type { Page, Route } from '@playwright/test'

const SONG_ID = '00000000-0000-4000-8000-00000000c0de'
const ORIGIN = 'http://127.0.0.1:5187'

/** Tiny valid WAV (8-bit silence) so the stem mixer can decode every synthetic stem. */
function tinyWav(): string {
  const samples = 8000
  const bytes = new Uint8Array(44 + samples)
  const view = new DataView(bytes.buffer)
  view.setUint32(0, 0x52494646, false) // "RIFF"
  view.setUint32(4, 36 + samples, true)
  view.setUint32(8, 0x57415645, false) // "WAVE"
  view.setUint32(12, 0x666d7420, false) // "fmt "
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, 1, true) // mono
  view.setUint32(24, 8000, true)
  view.setUint32(28, 8000, true)
  view.setUint16(32, 1, true)
  view.setUint16(34, 8, true)
  view.setUint32(36, 0x64617461, false) // "data"
  view.setUint32(40, samples, true)
  bytes.fill(0x80, 44)
  // Node's Buffer (fulfill bodies) without pulling Node types into the app tsconfig.
  return (globalThis as unknown as { Buffer: { from(a: Uint8Array): string } }).Buffer.from(bytes)
}

const chords = [
  { start_time: 0, end_time: 4, chord: 'Em', bass: null },
  { start_time: 4, end_time: 8, chord: 'G', bass: null },
  { start_time: 8, end_time: 12, chord: 'D', bass: null },
  { start_time: 12, end_time: 16, chord: 'A', bass: null },
]
const lyrics = [
  { start: 0, end: 4, text: 'Synthetic line one', words: [] },
  { start: 4, end: 8, text: 'Synthetic line two', words: [] },
  { start: 8, end: 12, text: 'Synthetic line three', words: [] },
]
const STEMS = ['vocals', 'guitar', 'drums', 'bass'] as const

const song = {
  id: SONG_ID,
  youtube_id: 'synthetic',
  title: 'Practice fixture',
  artist: 'Test Band',
  duration_seconds: 16,
  song_name: 'test_band/practice_fixture',
  thumbnail_key: null,
  thumbnail_url: null,
  audio_key: null,
  play_count: 3,
  created_at: null,
  difficulty: 'easy',
  chord_count: 4,
  easy_chords: ['Em', 'G', 'D', 'A'],
  easy_capo: null,
  tempo_bpm: 117,
}

function songDetail(locked: boolean) {
  const stems = Object.fromEntries(
    STEMS.map((name) => [name, locked && name !== 'guitar' ? null : `${ORIGIN}/fake-${name}.wav`]),
  )
  return {
    song,
    thumbnail_url: null,
    audio_url: `${ORIGIN}/fake-full.wav`,
    stems,
    stem_types: STEMS.map((name) => ({ name, label: name[0].toUpperCase() + name.slice(1) })),
    stems_locked: locked,
    chords,
    lyrics,
    lyrics_source: 'detected',
    quick_lyrics: [],
    quick_lyrics_source: null,
    chord_options: [{ name: 'Detected', description: 'Synthetic', capo: 0, hidden: false, is_variant: false, chords, lyrics, lyrics_source: 'detected', lyrics_synced: true }],
    chord_source: 'autochord',
    song_key: 'G',
    tabs: [],
    strums: [],
    rhythm: null,
    sections: [],
    active_job: null,
    download_pending: false,
    needs_self_heal: false,
  }
}

interface Mocks {
  progressPuts: unknown[]
  levelPuts: unknown[]
}

async function mockApi(page: Page, { tier }: { tier: 'pro' | 'free' }): Promise<Mocks> {
  const mocks: Mocks = { progressPuts: [], levelPuts: [] }
  const wav = tinyWav()
  // Loopback only: anything else is blocked, unknown API calls get an empty object.
  await page.context().route('**/*', (route: Route) => {
    const url = new URL(route.request().url())
    if (url.origin !== ORIGIN) return route.abort()
    if (url.pathname.startsWith('/fake-')) return route.fulfill({ body: wav, contentType: 'audio/wav' })
    if (url.pathname.startsWith('/api/')) return route.fulfill({ json: {} })
    // App modules load straight from the dev server (proxying them through
    // route.fetch() races Vite's dependency reloads).
    return route.fallback()
  })
  await page.route('**/api/v1/subscription/status', (route) => route.fulfill({ json: {
    has_access: tier === 'pro', tier, trial_ends_at: null, trial_active: false, subscription: null,
    has_seen_onboarding: true, is_admin: false, onboarding_song_id: null,
  } }))
  await page.route('**/api/v1/subscription/prices', (route) => route.fulfill({ json: {
    monthly: { id: 'allpay_monthly', name: 'Smart Guitar Pro', amount: '6.00', currency: 'USD', interval: 'month' },
    yearly: { id: 'allpay_yearly', name: 'Smart Guitar Pro Yearly', amount: '50.00', currency: 'USD', interval: 'year' },
  } }))
  await page.route('**/api/v1/favorites', (route) => route.fulfill({ json: { favorites: [] } }))
  await page.route('**/api/v1/practice/summary', (route) => route.fulfill({ json: {
    skill_level: null, streak_days: 0, practiced_today: false, continue_songs: [],
  } }))
  await page.route('**/api/v1/practice/level', async (route) => {
    const body = route.request().postDataJSON()
    mocks.levelPuts.push(body)
    await route.fulfill({ json: body })
  })
  await page.route(`**/api/v1/practice/songs/${SONG_ID}`, async (route) => {
    if (route.request().method() === 'PUT') {
      const body = route.request().postDataJSON()
      mocks.progressPuts.push(body)
      return route.fulfill({ json: { song_id: SONG_ID, last_practiced_at: new Date().toISOString(), ...body } })
    }
    return route.fulfill({ json: {
      song_id: SONG_ID, current_step: 1, completed_steps: [], learned_chords: [], stage_progress: 0, last_practiced_at: null,
    } })
  })
  await page.route(/\/api\/v1\/songs\/setlists(\?.*)?$/, (route) => route.fulfill({ json: { items: [
    { id: 'campfire', title: '4-Chord Campfire', description: 'Four easy shapes, whole songs.', level: 'easy', suggested_mode: 'play_along', song_count: 1, cover_urls: [] },
    { id: 'first-songs', title: 'Your First 10 Songs', description: 'Easy shapes for your first month.', level: 'easy', suggested_mode: 'learn', song_count: 1, cover_urls: [] },
  ] } }))
  await page.route(/\/api\/v1\/songs\/setlists\/[a-z-]+(\?.*)?$/, (route) => route.fulfill({ json: { items: [song], total: 1, offset: 0, limit: 20 } }))
  await page.route(/\/api\/v1\/songs(\?.*)?$/, (route) => route.fulfill({ json: { items: [song], total: 1, offset: 0, limit: 20 } }))
  await page.route(`**/api/v1/songs/${SONG_ID}`, (route) => route.fulfill({ json: songDetail(tier === 'free') }))
  return mocks
}

test.describe('Tonight’s practice home', () => {
  test('a new user picks a level, sees their first song and opens a setlist', async ({ authenticatedPage: page }) => {
    const mocks = await mockApi(page, { tier: 'pro' })
    await page.goto('/songs')

    await expect(page.getByRole('heading', { name: /tonight's practice/i })).toBeVisible()
    await expect(page.getByTestId('first-song-card')).toContainText(/practice fixture/i)
    await expect(page.getByTestId('first-song-card')).toContainText('Em · G · D · A')

    await page.getByTestId('level-picker-beginner').click()
    await expect(page.getByTestId('level-picker-beginner')).toHaveAttribute('aria-checked', 'true')
    await expect.poll(() => mocks.levelPuts).toEqual([{ skill_level: 'beginner' }])

    await page.getByTestId('setlist-card-campfire').click()
    await expect(page.getByTestId('setlist-title')).toHaveText('4-CHORD CAMPFIRE')
    await expect(page.getByTestId('setlist-songs').getByTestId('difficulty-easy')).toBeVisible()
  })

  test('adding a song from YouTube is Pro: free users get the paywall', async ({ authenticatedPage: page }) => {
    await mockApi(page, { tier: 'free' })
    await page.goto('/songs')
    await page.getByTestId('songs-search-input').fill('wonderwall')
    await page.getByTestId('songs-search-online-button').click()

    const paywall = page.getByTestId('paywall-dialog')
    await expect(paywall).toBeVisible()
    await expect(page.getByTestId('paywall-pitch')).toContainText(/add any song from youtube/i)
    await expect(page.getByTestId('paywall-yearly-button')).toContainText('$50')
    await expect(page.getByTestId('paywall-monthly-button')).toContainText('$6')
    await page.getByTestId('paywall-close-button').click()
    await expect(paywall).toHaveCount(0)
  })
})

test.describe('Song practice path', () => {
  test('Pro: hear it, learn the shapes, then take the guitarist’s seat', async ({ authenticatedPage: page }) => {
    const mocks = await mockApi(page, { tier: 'pro' })
    await page.goto(`/songs/${SONG_ID}`)

    const stage = page.getByTestId('band-stage')
    await expect(stage).toBeVisible()
    await expect(page.getByTestId('band-member-guitar')).toHaveAttribute('data-state', 'live')

    // Step 1 — only the guitarist plays.
    await page.getByTestId('practice-start-button').click()
    await expect(page.getByTestId('band-member-guitar')).toHaveAttribute('data-state', 'live')
    await expect(page.getByTestId('band-member-drums')).toHaveAttribute('data-state', 'muted')
    await expect(page.getByTestId('band-member-vocals')).toHaveAttribute('data-state', 'muted')

    // Step 2 — the song's shapes as cards to tick.
    await page.getByTestId('practice-finish-button').click()
    await expect(page.getByTestId('learn-shapes')).toBeVisible()
    await page.getByTestId('learn-shape-Em').click()
    await expect(page.getByTestId('learn-shape-Em')).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByTestId('playback-speed-selector')).toContainText('0.75x')
    await expect.poll(() => mocks.progressPuts.some((p) => JSON.stringify(p).includes('"learned_chords":["Em"]'))).toBe(true)

    // Step 3 — the band plays, the guitar seat is yours.
    await page.getByTestId('practice-finish-button').click()
    await expect(page.getByTestId('band-member-guitar')).toHaveAttribute('data-state', 'you')
    await expect(page.getByTestId('band-member-drums')).toHaveAttribute('data-state', 'live')
    await expect(page.getByTestId('stage-goal')).toBeVisible()
    await expect.poll(() => mocks.progressPuts.some((p) => (p as { current_step: number }).current_step === 3)).toBe(true)
    await expect(page.getByTestId('practice-step-2')).toHaveAttribute('data-done', 'true')

    // Tap a member to kick them out, tap the "YOU" seat to bring the guitarist back.
    await page.getByTestId('band-member-drums').click()
    await expect(page.getByTestId('band-member-drums')).toHaveAttribute('data-state', 'muted')
    await page.getByTestId('band-member-guitar').click()
    await expect(page.getByTestId('band-member-guitar')).toHaveAttribute('data-state', 'live')
  })

  test('Free: the band is locked, stepping on stage opens the paywall', async ({ authenticatedPage: page }) => {
    await mockApi(page, { tier: 'free' })
    await page.goto(`/songs/${SONG_ID}`)

    await expect(page.getByTestId('band-stage')).toContainText(/rest of the band is pro/i)
    await page.getByTestId('band-member-drums').click()
    await expect(page.getByTestId('paywall-dialog')).toBeVisible()
    await expect(page.getByTestId('paywall-pitch')).toContainText(/take the guitarist/i)
    await page.getByTestId('paywall-close-button').click()

    // Hear it and Learn it are free.
    await page.getByTestId('practice-start-button').click()
    await expect(page.getByTestId('practice-step-panel')).toContainText(/hear it/i)
    await page.getByTestId('practice-finish-button').click()
    await expect(page.getByTestId('learn-shapes')).toBeVisible()

    await page.getByTestId('practice-step-3').click()
    await expect(page.getByTestId('paywall-dialog')).toBeVisible()
    await expect(page.getByTestId('paywall-pitch')).toContainText(/step 3/i)
    await expect(page.getByTestId('paywall-progress')).toContainText(/practice fixture/i)
  })
})

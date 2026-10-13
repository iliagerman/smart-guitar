import type { Page } from '@playwright/test'
import { test, expect } from '../fixtures/auth'

// Real, short media file served as the song so the audio element plays and its clock advances.
const FAKE_AUDIO_FILE = new URL('../../../public/guitar.mp4', import.meta.url).pathname

const SONG_ID = 'a1b2c3d4-4eac-4245-8cc1-2bceea4a3368'

const CHORDS = [{ start_time: 0, end_time: 2, chord: 'G', bass: null }]
const LYRICS = [{ start: 0, end: 2, text: 'la la', words: [{ word: 'la', start: 0, end: 1 }, { word: 'la', start: 1, end: 2 }] }]

function chordOption(overrides: Record<string, unknown> = {}) {
  return {
    name: 'Detected', description: 'Auto-detected chords', capo: 0, hidden: false, is_variant: false,
    version_key: null, created_by: null, vote_score: 0, lyrics_source: 'detected', chords: CHORDS, lyrics: LYRICS,
    ...overrides,
  }
}

// A community sheet whose lines were spread over the song instead of aligned to the audio.
const ESTIMATED_SHEET = chordOption({
  name: 'Sheet 1', description: 'Community chord sheet', version_key: 'community:sheet1',
  lyrics_source: 'community', lyrics_synced: false,
})

/** The song as a free member gets it: the full mix and the guitar stem only. */
const FREE_SONG_DETAIL = {
  song: {
    id: SONG_ID, youtube_id: 'abc123', title: 'Bad Moon Rising', artist: 'CCR', duration_seconds: 16,
    song_name: 'ccr/bad_moon_rising', thumbnail_key: null, thumbnail_url: null, audio_key: null,
  },
  thumbnail_url: null, audio_url: 'processed',
  stems: { guitar: 'processed' },
  stem_types: [{ name: 'vocals' }, { name: 'guitar' }],
  stems_locked: true,
  chords: [], lyrics: LYRICS, lyrics_source: 'detected', quick_lyrics: [], quick_lyrics_source: null,
  chord_options: [chordOption(), ESTIMATED_SHEET],
  chord_source: 'autochord', recommended_capo: null, song_key: 'G',
  tabs: [], strums: [], rhythm: null, sections: [], active_job: null, download_pending: false,
}

interface TrackedEvent {
  event_type: string
  song_id?: string
  song_title?: string
  properties?: Record<string, unknown>
}

interface TrackedBatch {
  client?: Record<string, unknown>
  events: TrackedEvent[]
}

/** Records every analytics batch the app sends. */
async function captureAnalytics(page: Page): Promise<TrackedBatch[]> {
  const batches: TrackedBatch[] = []
  await page.route('**/api/v1/analytics/track/batch', async (route) => {
    const batch = route.request().postDataJSON() as TrackedBatch
    batches.push(batch)
    await route.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify({ accepted: batch.events.length }) })
  })
  return batches
}

function eventsOfType(batches: TrackedBatch[], eventType: string): TrackedEvent[] {
  return batches.flatMap((batch) => batch.events).filter((event) => event.event_type === eventType)
}

/** The tracker sends a batch every few seconds; wait for the event to arrive. */
async function waitForEvent(batches: TrackedBatch[], eventType: string, count = 1): Promise<TrackedEvent> {
  await expect.poll(() => eventsOfType(batches, eventType).length, { timeout: 15_000 }).toBeGreaterThanOrEqual(count)
  return eventsOfType(batches, eventType)[count - 1]
}

/** The phone layout has its own play button. */
function playButtonFor(page: Page) {
  return page.getByTestId(test.info().project.name === 'mobile' ? 'mobile-play-button' : 'player-play-button')
}

test.describe('Playback analytics', () => {
  test.beforeEach(async ({ authenticatedPage: page }) => {
    // No count-in, so pressing play starts the audio straight away.
    await page.addInitScript(() => {
      localStorage.setItem('player-prefs', JSON.stringify({ state: { countInEnabled: false }, version: 20 }))
    })
    await page.route('**/api/v1/subscription/status', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          has_access: false, tier: 'free', trial_ends_at: null, trial_active: false, subscription: null,
          has_seen_onboarding: true, is_admin: false, onboarding_song_id: null,
        }),
      }),
    )
    await page.route('**/api/v1/favorites', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ favorites: [] }) }),
    )
    await page.route(`**/api/v1/songs/${SONG_ID}`, (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(FREE_SONG_DETAIL) }),
    )
    await page.route('**/api/v1/songs/*/play', (route) => route.fulfill({ status: 204 }))
    await page.route('**/api/v1/songs/*/recommendations*', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ recommendations: [] }) }),
    )
    await page.route(`**/api/v1/songs/${SONG_ID}/stream*`, (route) =>
      route.fulfill({ path: FAKE_AUDIO_FILE, contentType: 'video/mp4', headers: { 'Accept-Ranges': 'bytes' } }),
    )
  })

  test('a play reports the device, the player setup, and how the audio ran', async ({ authenticatedPage: page }) => {
    const batches = await captureAnalytics(page)
    await page.goto(`/songs/${SONG_ID}`)
    await expect(page.getByTestId('transport-duration')).not.toHaveText('0:00', { timeout: 10_000 })

    const playButton = playButtonFor(page)
    await playButton.click()
    await page.waitForTimeout(1500)
    await playButton.click()

    const started = await waitForEvent(batches, 'playback_started')
    expect(started.song_id).toBe(SONG_ID)
    expect(started.song_title).toBe('Bad Moon Rising')
    expect(started.properties).toMatchObject({
      plan: 'free',
      audio: 'full_song',
      audio_engine: 'single',
      sheet: 'Detected',
      sheet_timing: 'audio',
      lyrics_mode: 'highlight',
      lyrics_choice: 'auto',
      lyrics_source: 'detected',
      lyrics_offset_ms: 0,
      playback_rate: 1,
      count_in: false,
    })

    const stopped = await waitForEvent(batches, 'playback_stopped')
    expect(stopped.properties).toMatchObject({ seeks: 0, ended: false })
    // About a second and a half of wall-clock time, with the audio clock moving along with it.
    expect(stopped.properties?.played_seconds).toBeGreaterThan(1)
    expect(stopped.properties?.audio_seconds).toBeGreaterThan(0.5)
    expect(stopped.properties?.position).toBeGreaterThan(0.5)

    for (const batch of batches) {
      expect(batch.client).toMatchObject({ standalone: false })
      expect(batch.client?.browser).toMatch(/^Chrome \d+$/)
      expect(batch.client?.viewport).toMatch(/^\d+x\d+$/)
      expect(batch.client?.app_version).toBeTruthy()
    }
  })

  test('switching to an estimated sheet and turning highlighting on is reported', async ({ authenticatedPage: page }) => {
    const batches = await captureAnalytics(page)
    await page.goto(`/songs/${SONG_ID}`)
    await expect(page.getByTestId('transport-duration')).not.toHaveText('0:00', { timeout: 10_000 })

    const playButton = playButtonFor(page)
    await playButton.click()
    await waitForEvent(batches, 'playback_started')
    await playButton.click()

    await page.getByTestId('sheet-source-tab-1').click()
    const sheetChanged = await waitForEvent(batches, 'player_settings_changed')
    // The player turns highlighting off for a sheet with estimated timing.
    expect(sheetChanged.properties).toMatchObject({ sheet: 'Sheet 1', sheet_timing: 'estimated', lyrics_mode: 'none' })

    await page.getByTestId('transport-toggle-secondary').click()
    await page.getByTestId('highlight-toggle').click()
    const highlightOn = await waitForEvent(batches, 'player_settings_changed', 2)
    expect(highlightOn.properties).toMatchObject({ sheet: 'Sheet 1', sheet_timing: 'estimated', lyrics_mode: 'highlight' })
  })
})

test.describe('Analytics dashboard timeline', () => {
  test('shows the device and the details of each event', async ({ authenticatedPage: page }) => {
    const client = {
      device: 'iPhone', os: 'iOS 18.5', browser: 'Safari 18.5', standalone: false,
      viewport: '390x844', app_version: 'v1300 · 0af270d · 2026-10-13 09:00',
    }
    const event = (id: string, eventType: string, properties: Record<string, unknown> | null) => ({
      id, created_at: '2026-10-10T05:59:29Z', event_type: eventType, event_category: 'player', event_source: 'client',
      user_email: 'member@example.com', tenant_id: null, aws_account_id: null,
      song_id: SONG_ID, song_title: 'Bad Moon Rising', session_id: 's1', properties,
    })
    await page.route('**/api/v1/analytics/access', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ allowed: true, email: 'test@example.com' }) }),
    )
    await page.route('**/api/v1/analytics/user-emails*', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: ['member@example.com'] }) }),
    )
    await page.route('**/api/v1/analytics/dashboard*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          window_start: '2026-09-14T00:00:00Z', window_end: '2026-10-13T23:59:59Z', granularity: 'day',
          overview: { total_events: 2, unique_users: 1, total_sessions: 1, login_count: 0, song_play_count: 1 },
          trends: [], event_breakdown: [], top_songs: [], user_activity: [],
          recent_events: [
            event('e1', 'playback_started', { plan: 'free', sheet: 'Sheet 1', sheet_timing: 'estimated', lyrics_mode: 'highlight', client }),
            event('e2', 'song_played', null),
          ],
        }),
      }),
    )

    await page.goto('/analytics')

    const rows = page.getByTestId('recent-event-row')
    await expect(rows).toHaveCount(2)
    await expect(rows.nth(0)).toContainText('iPhone · iOS 18.5 · Safari 18.5')
    await expect(rows.nth(0)).toContainText('v1300 · 0af270d · 2026-10-13 09:00 · 390x844')
    await expect(rows.nth(0)).toContainText('sheet_timing estimated')
    await expect(rows.nth(0)).toContainText('lyrics_mode highlight')
    // Events recorded before the device was tracked still render.
    await expect(rows.nth(1)).toContainText('song_played')
  })
})

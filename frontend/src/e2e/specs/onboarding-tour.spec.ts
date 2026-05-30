import { test, expect } from '../fixtures/auth'

const songId = '0b59abe8-4eac-4245-8cc1-2bceea4a3368'

/**
 * Minimal valid WAV file (44-byte header + 800 samples of silence).
 * Enough for the browser to accept the audio element source.
 */
function makeTinyWav(): Uint8Array {
  const numSamples = 800
  const dataSize = numSamples
  const fileSize = 36 + dataSize
  const buf = new ArrayBuffer(44 + dataSize)
  const view = new DataView(buf)

  view.setUint32(0, 0x52494646, false) // "RIFF"
  view.setUint32(4, fileSize, true)
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
  view.setUint32(40, dataSize, true)

  const bytes = new Uint8Array(buf)
  bytes.fill(0x80, 44, 44 + dataSize)
  return bytes
}

// Song detail with chords so PlayerControls (and all the onboarding tour
// targets) render with real content.
function makeSongDetail() {
  return {
    song: {
      id: songId,
      youtube_id: 'abc123',
      title: 'Test Song',
      artist: 'Test Artist',
      duration_seconds: 300,
      song_name: 'test_artist/test_song',
      thumbnail_key: null,
      thumbnail_url: null,
      audio_key: 'test-audio-key',
    },
    thumbnail_url: null,
    audio_url: 'https://example.com/audio.mp3',
    stems: {
      vocals: 'https://example.com/vocals.mp3',
      guitar: 'https://example.com/guitar.mp3',
    },
    stem_types: [
      { name: 'vocals', label: 'Vocals' },
      { name: 'guitar', label: 'Guitar' },
    ],
    chords: [{ chord: 'Am', time: 0 }, { chord: 'G', time: 2.5 }],
    lyrics: [],
    lyrics_source: null,
    quick_lyrics: [],
    quick_lyrics_source: null,
    corrected_lyrics: [],
    corrected_lyrics_source: null,
    chord_options: [
      {
        key: 'default',
        name: 'Default',
        source: 'gemini',
        hidden: false,
        is_variant: false,
        chords: [{ chord: 'Am', time: 0 }, { chord: 'G', time: 2.5 }],
        lyrics: [],
        lyrics_source: null,
      },
    ],
    tabs: [],
    strums: [],
    rhythm: null,
    sections: [],
    active_job: null,
    download_pending: false,
    chord_source: 'gemini',
  }
}

test.describe('Onboarding tour reset (admin)', () => {
  test('resetting the tour from the admin menu shows it without a page reload', async ({
    authenticatedPage: page,
  }) => {
    // Backend-like state: the onboarding flag the /status endpoint reports.
    // Resetting flips it to false, exactly like the real reset endpoint.
    let hasSeenOnboarding = true

    // Override the fixture's subscription mock: this user is an admin (so the
    // admin menu renders) and has already seen onboarding (so the tour is
    // hidden until reset).
    await page.route('**/api/v1/subscription/status', async (route) => {
      if (route.request().method() !== 'GET') return route.continue()
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          has_access: true,
          trial_ends_at: null,
          trial_active: false,
          subscription: null,
          has_seen_onboarding: hasSeenOnboarding,
          is_admin: true,
          onboarding_song_id: null,
        }),
      })
    })

    // The reset endpoint flips the persisted flag, like the real backend.
    await page.route('**/api/v1/subscription/onboarding-reset', async (route) => {
      if (route.request().method() !== 'POST') return route.continue()
      hasSeenOnboarding = false
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'ok' }),
      })
    })

    // Favorites — empty.
    await page.route('**/api/v1/favorites', async (route) => {
      if (route.request().method() !== 'GET') return route.continue()
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ favorites: [] }),
      })
    })

    // Song detail.
    await page.route(`**/api/v1/songs/${songId}`, async (route) => {
      const url = route.request().url()
      if (url.includes('/recommendations') || url.includes('/play') || url.includes('/stream')) {
        return route.continue()
      }
      if (route.request().method() !== 'GET') return route.continue()
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(makeSongDetail()),
      })
    })

    // Audio streams.
    const toBuffer = (globalThis as unknown as { Buffer: { from(a: Uint8Array): string } }).Buffer.from
    const wavBody = toBuffer(makeTinyWav())
    await page.route(`**/api/v1/songs/${songId}/stream**`, async (route) => {
      await route.fulfill({ status: 200, contentType: 'audio/wav', body: wavBody })
    })
    await page.route('https://example.com/**', async (route) => {
      await route.fulfill({ status: 200, contentType: 'audio/wav', body: wavBody })
    })

    // Song is complete — block job creation.
    await page.route('**/api/v1/jobs', async (route) => {
      if (route.request().method() === 'POST') return route.abort()
      await route.continue()
    })

    await page.goto(`/songs/${songId}`)
    await expect(page.getByTestId('song-detail-page')).toBeVisible({ timeout: 15000 })

    // Tour is hidden initially (user has already seen onboarding).
    await expect(page.getByTestId('tour-next-button')).toHaveCount(0)

    // Reset onboarding from the admin menu.
    await page.getByTestId('admin-menu-toggle').click()
    await page.getByTestId('admin-menu-reset-onboarding').click()

    // The tour must appear without any page reload.
    await expect(page.getByTestId('tour-next-button')).toBeVisible({ timeout: 10000 })
  })
})

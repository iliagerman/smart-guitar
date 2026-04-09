import { test, expect } from '../fixtures/auth'

const songId = '0b59abe8-4eac-4245-8cc1-2bceea4a3368'

/**
 * Minimal valid WAV file (44-byte header + 800 samples of silence).
 * ~0.1s at 8kHz 8-bit mono — enough for the browser to play and trigger ended.
 */
function makeTinyWav(): Uint8Array {
  const numSamples = 800
  const dataSize = numSamples
  const fileSize = 36 + dataSize
  const buf = new ArrayBuffer(44 + dataSize)
  const view = new DataView(buf)

  // RIFF header
  view.setUint32(0, 0x52494646, false) // "RIFF"
  view.setUint32(4, fileSize, true)
  view.setUint32(8, 0x57415645, false) // "WAVE"

  // fmt subchunk
  view.setUint32(12, 0x666D7420, false) // "fmt "
  view.setUint32(16, 16, true) // subchunk size
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, 1, true) // mono
  view.setUint32(24, 8000, true) // sample rate
  view.setUint32(28, 8000, true) // byte rate
  view.setUint16(32, 1, true) // block align
  view.setUint16(34, 8, true) // bits per sample

  // data subchunk
  view.setUint32(36, 0x64617461, false) // "data"
  view.setUint32(40, dataSize, true)

  // Fill samples with silence (0x80 for unsigned 8-bit)
  const bytes = new Uint8Array(buf)
  bytes.fill(0x80, 44, 44 + dataSize)

  return bytes
}

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

function makeRecommendations() {
  return {
    items: [
      {
        id: 'rec-song-1',
        youtube_id: 'yt1',
        title: 'Recommended Song 1',
        artist: 'Artist One',
        duration_seconds: 240,
        song_name: 'artist_one/recommended_song_1',
        thumbnail_key: null,
        thumbnail_url: null,
        audio_key: null,
      },
      {
        id: 'rec-song-2',
        youtube_id: 'yt2',
        title: 'Recommended Song 2',
        artist: 'Artist Two',
        duration_seconds: 200,
        song_name: 'artist_two/recommended_song_2',
        thumbnail_key: null,
        thumbnail_url: null,
        audio_key: null,
      },
    ],
    seed_song_id: songId,
  }
}

test.describe('Recommendations prefetch', () => {
  test('recommendations are prefetched during playback and appear instantly when stopped', async ({ authenticatedPage: page }) => {
    let recommendationsRequestCount = 0

    // Mock favorites
    await page.route('**/api/v1/favorites', async (route) => {
      if (route.request().method() !== 'GET') return route.continue()
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ favorites: [] }),
      })
    })

    // Mock song detail
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

    // Mock play recording
    await page.route(`**/api/v1/songs/${songId}/play`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ detail: 'ok' }),
      })
    })

    // Serve a tiny valid WAV so the browser can actually play and trigger ended.
    // Access Node's Buffer via globalThis to avoid needing @types/node in frontend tsconfig.
    const toBuffer = (globalThis as unknown as { Buffer: { from(a: Uint8Array): string } }).Buffer.from
    const wavBody = toBuffer(makeTinyWav())
    await page.route(`**/api/v1/songs/${songId}/stream**`, async (route) => {
      await route.fulfill({ status: 200, contentType: 'audio/wav', body: wavBody })
    })
    await page.route('https://example.com/**', async (route) => {
      await route.fulfill({ status: 200, contentType: 'audio/wav', body: wavBody })
    })

    // Block job creation — song is complete
    await page.route('**/api/v1/jobs', async (route) => {
      if (route.request().method() === 'POST') {
        await route.abort()
        return
      }
      await route.continue()
    })

    // Mock recommendations API — track when it's called
    await page.route(`**/api/v1/songs/${songId}/recommendations**`, async (route) => {
      recommendationsRequestCount++
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(makeRecommendations()),
      })
    })

    await page.goto(`/songs/${songId}`)
    await expect(page.getByTestId('song-detail-page')).toBeVisible({ timeout: 15000 })

    // Before playing — recommendations API should not have been called
    expect(recommendationsRequestCount).toBe(0)

    // Click play — with empty audio it ends immediately, so hasPlaybackOccurred
    // becomes true and isPlaying returns to false, triggering recommendations display.
    await page.getByTestId('player-play-button').click()

    // Wait for the recommendations API to be called (prefetch triggered by hasPlaybackOccurred)
    await expect(async () => {
      expect(recommendationsRequestCount).toBeGreaterThanOrEqual(1)
    }).toPass({ timeout: 5000 })

    // Recommendations should appear with actual content (not loading skeletons)
    // because the prefetch already populated React Query cache.
    await expect(page.getByTestId('recommended-songs')).toBeVisible({ timeout: 2000 })
    await expect(page.getByTestId('recommended-song-rec-song-1')).toBeVisible()
    await expect(page.getByTestId('recommended-song-rec-song-2')).toBeVisible()
  })
})

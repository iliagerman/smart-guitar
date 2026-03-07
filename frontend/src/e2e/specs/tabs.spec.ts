import { test, expect } from '../fixtures/auth'

test.describe('Tabs (UI contract)', () => {
    test('song detail API response may include tabs without breaking the UI', async ({ authenticatedPage: page }) => {
        const songId = '0b59abe8-4eac-4245-8cc1-2bceea4a3368'

        // Favorites are fetched on the song detail page.
        await page.route('**/api/v1/favorites', async (route) => {
            if (route.request().method() !== 'GET') return route.continue()
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ favorites: [] }),
            })
        })

        // Mock the song detail endpoint to include a minimal tabs payload.
        // This is a contract test: the UI must not crash when tabs are present.
        await page.route(`**/api/v1/songs/${songId}`, async (route) => {
            if (route.request().method() !== 'GET') return route.continue()

            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    song: {
                        id: songId,
                        youtube_id: 'abc123',
                        title: 'Stairway to Heaven',
                        artist: 'Led Zeppelin',
                        duration_seconds: 480,
                        song_name: 'led_zeppelin/stairway_to_heaven',
                        thumbnail_key: null,
                        audio_key: null,
                    },
                    thumbnail_url: null,
                    audio_url: null,
                    stems: {},
                    stem_types: [],
                    chords: [],
                    lyrics: [{ start: 0, end: 1, text: 'hello', words: [] }],
                    chord_options: [],
                    // Forward-compat: backend may include additional fields like `tabs`.
                    tabs: [
                        {
                            start_time: 0.0,
                            end_time: 0.5,
                            string: 1,
                            fret: 3,
                            midi_pitch: 67,
                            confidence: 0.9,
                        },
                    ],
                }),
            })
        })

        await page.goto(`/songs/${songId}`)
        await expect(page.getByTestId('song-detail-page')).toBeVisible()
    })
})

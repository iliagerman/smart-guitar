import { describe, it, expect } from 'vitest'
import { songDetailRefetchInterval } from './use-song-detail'
import type { SongDetail } from '@/types/song'

/**
 * Build a "fully loaded" SongDetail (nothing pending) and override per test.
 * Only the fields the poll function reads need to be realistic.
 */
function makeDetail(overrides: Partial<SongDetail> = {}): SongDetail {
  const seg = [{ start: 0, end: 1, text: 'la', words: [] }]
  return {
    stem_types: [{ name: 'vocals' }],
    stems: { vocals: 'https://example/vocals.mp3' },
    quick_lyrics: seg,
    lyrics: seg,
    tabs: [{ start_time: 0, end_time: 1, string: 0, fret: 0, midi_pitch: 40, confidence: 1 }],
    songsterr_status: 'ready',
    chord_options: [{ name: 'Community', description: 'Community chord sheet (UG)' }],
    active_job: null,
    download_pending: false,
    ...overrides,
  } as unknown as SongDetail
}

describe('songDetailRefetchInterval', () => {
  it('stops polling when the song is fully loaded', () => {
    expect(songDetailRefetchInterval(makeDetail(), false)).toBe(false)
  })

  it('polls while a job is active', () => {
    expect(songDetailRefetchInterval(makeDetail({ active_job: { id: 'j', status: 'RUNNING' } as never }), false)).toBe(6000)
  })

  it('polls while audio download is pending', () => {
    expect(songDetailRefetchInterval(makeDetail({ download_pending: true }), false)).toBe(6000)
  })

  it('polls while a stem is still missing', () => {
    expect(songDetailRefetchInterval(makeDetail({ stems: {} as never }), false)).toBe(6000)
  })

  it('polls while songsterr data is still pending', () => {
    expect(songDetailRefetchInterval(makeDetail({ songsterr_status: null }), false)).toBe(5000)
  })

  it('polls while ver2 lyrics are missing', () => {
    expect(
      songDetailRefetchInterval(makeDetail({ lyrics: [], ver2_lyrics: [] }), false),
    ).toBe(12000)
  })

  it('stops polling once ver1+ver2 lyrics exist (no merged version to wait for)', () => {
    const detail = makeDetail()
    expect(songDetailRefetchInterval(detail, false)).toBe(false)
  })
})

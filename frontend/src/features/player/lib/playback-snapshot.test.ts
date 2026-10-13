import { describe, it, expect } from 'vitest'
import { buildPlaybackSnapshot, summarizePlaybackRun, type PlaybackSnapshotInput } from './playback-snapshot'
import type { ChordOption } from '@/types/song'

function option(partial: Partial<ChordOption>): ChordOption {
  return { name: 'Detected', description: 'Auto-detected chords', capo: 0, chords: [], ...partial }
}

const DETECTED = option({ lyrics_source: 'lrclib_synced+whisper' })
const UNSYNCED_SHEET = option({
  name: 'Sheet 1',
  description: 'Community chord sheet (Key: D)',
  lyrics_source: 'community',
  lyrics_synced: false,
})
const SYNCED_SHEET = option({
  name: 'Sheet 2',
  description: 'Community chord sheet · synced to audio',
  lyrics_source: 'community',
  lyrics_synced: true,
})

function snapshot(overrides: Partial<PlaybackSnapshotInput> = {}) {
  return buildPlaybackSnapshot({
    sheet: DETECTED,
    sheetIndex: 0,
    lyricsMode: 'highlight',
    lyricsChoice: 'auto',
    lyricsSource: 'lrclib_synced+whisper',
    lyricsOffsetMs: 0,
    isFullSong: false,
    activeStems: ['vocals', 'guitar', 'drums', 'bass'],
    stemsLocked: false,
    playbackRate: 1,
    transposeSemitones: 0,
    sheetMode: 'chords',
    countInEnabled: true,
    skipInstrumentals: false,
    ...overrides,
  })
}

describe('buildPlaybackSnapshot', () => {
  it('describes a Pro member mixing every stem over the detected sheet', () => {
    expect(snapshot()).toEqual({
      plan: 'pro',
      audio: 'vocals+guitar+drums+bass',
      audio_engine: 'mixer',
      sheet: 'Detected',
      sheet_timing: 'audio',
      lyrics_mode: 'highlight',
      lyrics_choice: 'auto',
      lyrics_source: 'lrclib_synced+whisper',
      lyrics_offset_ms: 0,
      playback_rate: 1,
      transpose: 0,
      sheet_mode: 'chords',
      count_in: true,
      skip_instrumentals: false,
    })
  })

  it('shows a free member on the single audio element, for the full song and for the guitar alone', () => {
    expect(snapshot({ stemsLocked: true, isFullSong: true, activeStems: [] })).toMatchObject({
      plan: 'free',
      audio: 'full_song',
      audio_engine: 'single',
    })
    expect(snapshot({ stemsLocked: true, activeStems: ['guitar'] })).toMatchObject({
      plan: 'free',
      audio: 'guitar',
      audio_engine: 'single',
    })
  })

  it('flags highlighting switched on over a sheet that only has estimated timing', () => {
    expect(
      snapshot({ sheet: UNSYNCED_SHEET, sheetIndex: 1, lyricsMode: 'highlight', lyricsSource: 'community' }),
    ).toMatchObject({
      sheet: 'Sheet 1',
      sheet_timing: 'estimated',
      lyrics_mode: 'highlight',
      lyrics_source: 'community',
    })
    expect(snapshot({ sheet: SYNCED_SHEET, sheetIndex: 2 })).toMatchObject({ sheet: 'Sheet 2', sheet_timing: 'audio' })
  })

  it('carries the settings a member changed', () => {
    expect(
      snapshot({ lyricsChoice: 'ver1', lyricsSource: 'lrclib_quick_synced', lyricsOffsetMs: -250, playbackRate: 0.75, transposeSemitones: 2 }),
    ).toMatchObject({
      lyrics_choice: 'ver1',
      lyrics_source: 'lrclib_quick_synced',
      lyrics_offset_ms: -250,
      playback_rate: 0.75,
      transpose: 2,
    })
  })

  it('leaves the lyrics source out when the song has no lyrics', () => {
    expect(snapshot({ lyricsSource: null })).not.toHaveProperty('lyrics_source')
  })
})

describe('summarizePlaybackRun', () => {
  it('reports wall-clock time next to how far the audio moved, so a stalled or drifting clock shows', () => {
    expect(
      summarizePlaybackRun({ startedAtMs: 1_000, endedAtMs: 45_000, audioSeconds: 40.123, seeks: 0, position: 40.567, duration: 138.07 }),
    ).toEqual({ position: 40.6, played_seconds: 44, audio_seconds: 40.1, seeks: 0, ended: false })
  })

  it('marks a run that reached the end of the song', () => {
    expect(
      summarizePlaybackRun({ startedAtMs: 0, endedAtMs: 20_000, audioSeconds: 20, seeks: 1, position: 138.07, duration: 138.07 }),
    ).toMatchObject({ seeks: 1, ended: true })
  })
})

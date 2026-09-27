import { describe, it, expect } from 'vitest'
import { beatIndexAt, gridSubdivisionAt, songBeatTimes, songTempoBpm } from './song-beat-grid'

describe('songTempoBpm', () => {
  it('prefers the tempo measured from the recording over the tab tempo', () => {
    expect(songTempoBpm({ detected_bpm: 114.29, source_bpm: 116, rhythm: null })).toBe(114.29)
  })

  it('falls back to the tab tempo, then the guitar-stem tempo', () => {
    expect(songTempoBpm({ detected_bpm: null, source_bpm: 96, rhythm: { bpm: 101, beat_times: [] } })).toBe(96)
    expect(songTempoBpm({ detected_bpm: null, source_bpm: null, rhythm: { bpm: 101, beat_times: [] } })).toBe(101)
  })

  it('returns null when the song has no tempo', () => {
    expect(songTempoBpm({ detected_bpm: null, source_bpm: null, rhythm: null })).toBeNull()
  })
})

describe('songBeatTimes', () => {
  it('returns the detected beats', () => {
    expect(songBeatTimes({ beat_times: [0.5, 1, 1.5] })).toEqual([0.5, 1, 1.5])
  })

  it('returns null when no beats were detected', () => {
    expect(songBeatTimes({ beat_times: [] })).toBeNull()
    expect(songBeatTimes({})).toBeNull()
  })
})

describe('gridSubdivisionAt', () => {
  const beatTimes = [0.7, 1.2, 1.8, 2.4]

  it('puts the first detected downbeat on beat one, not 0:00', () => {
    expect(gridSubdivisionAt(beatTimes, 0.7)).toEqual({ subdivisionNumber: 0, secondsAfterSubdivision: 0 })
  })

  it('follows uneven beat spacing instead of a fixed tempo', () => {
    // Second beat is 0.6 s long, so its off-beat starts at 1.5 s.
    expect(gridSubdivisionAt(beatTimes, 1.3)?.subdivisionNumber).toBe(2)
    expect(gridSubdivisionAt(beatTimes, 1.55)?.subdivisionNumber).toBe(3)
    expect(gridSubdivisionAt(beatTimes, 1.55)?.secondsAfterSubdivision).toBeCloseTo(0.05)
  })

  it('returns null before the first beat and after the last beat', () => {
    expect(gridSubdivisionAt(beatTimes, 0.2)).toBeNull()
    expect(gridSubdivisionAt(beatTimes, 2.4)).toBeNull()
  })
})

describe('beatIndexAt', () => {
  const beatTimes = [0.7, 1.2, 1.8, 2.4]

  it('returns the beat sounding at the playback time', () => {
    expect(beatIndexAt(beatTimes, 0.7)).toBe(0)
    expect(beatIndexAt(beatTimes, 1.79)).toBe(1)
    expect(beatIndexAt(beatTimes, 1.8)).toBe(2)
  })

  it('returns null outside the detected beats', () => {
    expect(beatIndexAt(beatTimes, 0.69)).toBeNull()
    expect(beatIndexAt(beatTimes, 2.4)).toBeNull()
  })
})

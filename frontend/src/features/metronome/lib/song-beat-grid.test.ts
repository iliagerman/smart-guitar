import { describe, it, expect } from 'vitest'
import { beatIndexAt, firstSubdivisionFrom, songBeatTimes, songTempoBpm, subdivisionTime } from './song-beat-grid'

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

describe('subdivisionTime', () => {
  const beatTimes = [0.7, 1.2, 1.8, 2.4]

  it('puts the first detected downbeat on beat one, not 0:00', () => {
    expect(subdivisionTime(beatTimes, 120, 0)).toBe(0.7)
  })

  it('follows uneven beat spacing instead of a fixed tempo', () => {
    // Second beat is 0.6 s long, so its off-beat lands at 1.5 s.
    expect(subdivisionTime(beatTimes, 120, 2)).toBe(1.2)
    expect(subdivisionTime(beatTimes, 120, 3)).toBeCloseTo(1.5)
  })

  it('ends with the detected beats', () => {
    expect(subdivisionTime(beatTimes, 120, 5)).toBeCloseTo(2.1)
    expect(subdivisionTime(beatTimes, 120, 6)).toBeNull()
  })

  it('uses a fixed tempo from 0:00 when no beats were detected', () => {
    expect(subdivisionTime(null, 120, 0)).toBe(0)
    expect(subdivisionTime(null, 120, 3)).toBeCloseTo(0.75)
  })
})

describe('firstSubdivisionFrom', () => {
  const beatTimes = [0.7, 1.2, 1.8, 2.4]

  it('starts on beat one before the first detected beat', () => {
    expect(firstSubdivisionFrom(beatTimes, 120, 0)).toBe(0)
    expect(firstSubdivisionFrom(beatTimes, 120, 0.7)).toBe(0)
  })

  it('never returns a half-beat that has already passed', () => {
    expect(firstSubdivisionFrom(beatTimes, 120, 0.71)).toBe(1)
    expect(firstSubdivisionFrom(beatTimes, 120, 1.2)).toBe(2)
    expect(firstSubdivisionFrom(beatTimes, 120, 1.51)).toBe(4)
  })

  it('returns null once the detected beats are over', () => {
    expect(firstSubdivisionFrom(beatTimes, 120, 2.2)).toBeNull()
    expect(firstSubdivisionFrom(beatTimes, 120, 3)).toBeNull()
  })

  it('counts half-beats of a fixed tempo when no beats were detected', () => {
    expect(firstSubdivisionFrom(null, 120, 0)).toBe(0)
    expect(firstSubdivisionFrom(null, 120, 0.25)).toBe(1)
    expect(firstSubdivisionFrom(null, 120, 0.26)).toBe(2)
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

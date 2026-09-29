import { describe, expect, it } from 'vitest'
import { beatCount, chordBeats, holdLabel, nearestBeatIndex } from './chord-beats'

const beats = [1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5]

describe('nearestBeatIndex', () => {
  it('snaps to the closest beat on either side', () => {
    expect(nearestBeatIndex(beats, 0)).toBe(0)
    expect(nearestBeatIndex(beats, 1.2)).toBe(0)
    expect(nearestBeatIndex(beats, 1.3)).toBe(1)
    expect(nearestBeatIndex(beats, 9)).toBe(8)
  })
})

describe('chordBeats', () => {
  it('counts the beats a chord is held for, snapping slightly early changes', () => {
    expect(chordBeats(beats, 0.97, 2.98)).toEqual({ first: 0, count: 4 })
    expect(chordBeats(beats, 3.04, 3.52)).toEqual({ first: 4, count: 1 })
  })

  it('never shows a chord as lasting no beats', () => {
    expect(chordBeats(beats, 2.01, 2.1)).toEqual({ first: 2, count: 1 })
  })

  it('is null without a beat grid or outside it', () => {
    expect(chordBeats(null, 1, 2)).toBeNull()
    expect(chordBeats([1], 1, 2)).toBeNull()
    expect(chordBeats(beats, 0, 0.9)).toBeNull()
    expect(chordBeats(beats, 5, 6)).toBeNull()
  })
})

describe('holdLabel', () => {
  it('names short holds in beats and long ones in bars', () => {
    expect(holdLabel(1, 4)).toBe('1 beat')
    expect(holdLabel(3, 4)).toBe('3 beats')
    expect(holdLabel(4, 4)).toBe('1 bar')
    expect(holdLabel(6, 4)).toBe('1½ bars')
    expect(holdLabel(8, 4)).toBe('2 bars')
    expect(holdLabel(3, 3)).toBe('1 bar')
  })
})

describe('beatCount', () => {
  it('numbers the beats the chord is held, from the change', () => {
    expect(beatCount({ first: 0, count: 4 }, 4)).toEqual({ counts: [1, 2, 3, 4], bars: null })
    expect(beatCount({ first: 6, count: 2 }, 4)).toEqual({ counts: [1, 2], bars: null })
  })

  it('shows one bar and how many bars for a longer hold', () => {
    expect(beatCount({ first: 4, count: 8 }, 4)).toEqual({ counts: [1, 2, 3, 4], bars: '2' })
    expect(beatCount({ first: 0, count: 6 }, 4)).toEqual({ counts: [1, 2, 3, 4], bars: '1½' })
  })
})

import { describe, it, expect } from 'vitest'
import { mergeChordLyrics, findActiveChordIndex } from './merge-chords-lyrics'
import type { ChordEntry, LyricsSegment, LyricsWord } from '@/types/song'

function seg(start: number, end: number, text: string, words: LyricsWord[]): LyricsSegment {
  return { start, end, text, words }
}

describe('mergeChordLyrics chord layout', () => {
  it('assigns non-decreasing charOffset in start_time order within a line', () => {
    const lyrics = [
      seg(0, 8, 'one two three four', [
        { word: 'one', start: 0, end: 2 },
        { word: 'two', start: 2, end: 4 },
        { word: 'three', start: 4, end: 6 },
        { word: 'four', start: 6, end: 8 },
      ]),
    ]
    const chords: ChordEntry[] = [
      { start_time: 0, end_time: 2, chord: 'C' },
      { start_time: 2, end_time: 4, chord: 'G' },
      { start_time: 4, end_time: 6, chord: 'Am' },
      { start_time: 6, end_time: 8, chord: 'F' },
    ]

    const lines = mergeChordLyrics(chords, lyrics)
    const offsets = lines[0].chords.map((c) => c.charOffset)

    for (let i = 1; i < offsets.length; i++) {
      expect(offsets[i]).toBeGreaterThanOrEqual(offsets[i - 1])
    }
  })

  it('stacks several non-simultaneous chords on the matching long word', () => {
    // The word "one" spans 0..6; all three chords naturally land on it.
    const lyrics = [
      seg(0, 8, 'one two three', [
        { word: 'one', start: 0, end: 6 },
        { word: 'two', start: 6, end: 7 },
        { word: 'three', start: 7, end: 8 },
      ]),
    ]
    const chords: ChordEntry[] = [
      { start_time: 0, end_time: 2, chord: 'C' },
      { start_time: 2, end_time: 4, chord: 'G' },
      { start_time: 4, end_time: 6, chord: 'Am' },
    ]

    const lines = mergeChordLyrics(chords, lyrics)
    const offsets = lines[0].chords.map((c) => c.charOffset)

    // Preserve timing: all three chords belong to the word active at their start.
    expect(new Set(offsets).size).toBe(1)
  })

  it('keeps essentially simultaneous chords stacked rather than spreading them', () => {
    const lyrics = [
      seg(0, 8, 'one two three', [
        { word: 'one', start: 0, end: 6 },
        { word: 'two', start: 6, end: 7 },
        { word: 'three', start: 7, end: 8 },
      ]),
    ]
    const chords: ChordEntry[] = [
      { start_time: 0, end_time: 6, chord: 'C' },
      { start_time: 0.05, end_time: 6, chord: 'G' }, // 50ms apart: same moment
    ]

    const lines = mergeChordLyrics(chords, lyrics)
    const offsets = lines[0].chords.map((c) => c.charOffset)

    expect(offsets[0]).toBe(offsets[1])
  })

  it('stacks extra chords in time order when there are more chords than words', () => {
    const lyrics = [seg(0, 4, 'solo', [{ word: 'solo', start: 0, end: 4 }])]
    const chords: ChordEntry[] = [
      { start_time: 0, end_time: 1, chord: 'C' },
      { start_time: 1, end_time: 2, chord: 'G' },
      { start_time: 2, end_time: 3, chord: 'Am' },
    ]

    const lines = mergeChordLyrics(chords, lyrics)
    const labels = lines[0].chords.map((c) => c.chord)
    const offsets = lines[0].chords.map((c) => c.charOffset)

    expect(labels).toEqual(['C', 'G', 'Am'])
    for (let i = 1; i < offsets.length; i++) {
      expect(offsets[i]).toBeGreaterThanOrEqual(offsets[i - 1])
    }
  })
})

describe('findActiveChordIndex', () => {
  const chords = [
    { start_time: 0, end_time: 1 },
    { start_time: 1, end_time: 2 },
    { start_time: 3, end_time: 4 }, // gap between 2s and 3s
  ]

  it('returns -1 before the first chord starts', () => {
    expect(findActiveChordIndex(chords, -0.5)).toBe(-1)
  })

  it('returns the latest chord started at or before the time', () => {
    expect(findActiveChordIndex(chords, 0.5)).toBe(0)
    expect(findActiveChordIndex(chords, 1.5)).toBe(1)
    expect(findActiveChordIndex(chords, 3.2)).toBe(2)
  })

  it('keeps the previous chord during a gap instead of clearing the highlight', () => {
    expect(findActiveChordIndex(chords, 2.5)).toBe(1)
  })

  it('never moves backward as time advances (monotonic)', () => {
    let prev = -1
    for (let t = -0.5; t <= 4.5; t += 0.1) {
      const idx = findActiveChordIndex(chords, t)
      expect(idx).toBeGreaterThanOrEqual(prev)
      prev = idx
    }
  })

  it('picks the latest-started chord when intervals overlap', () => {
    const overlapping = [
      { start_time: 0, end_time: 4 },
      { start_time: 2, end_time: 3 },
    ]
    expect(findActiveChordIndex(overlapping, 2.5)).toBe(1)
  })
})

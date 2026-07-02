import { describe, it, expect } from 'vitest'
import { createScanCursor } from '../lib/cursor-scan'
import { findActiveChordEntry, filterRealChords } from './use-current-chord'
import type { ChordEntry } from '@/types/song'

function chord(chord: string, start_time: number, end_time: number): ChordEntry {
  return { chord, start_time, end_time }
}

// Reference implementation matching the original CurrentChordPanel.findDisplayChord,
// used to verify the cursor-based version is behaviorally identical.
function findDisplayChordReference(chords: ChordEntry[], currentTime: number): ChordEntry | null {
  const active = chords.find(
    (c) => currentTime >= c.start_time && currentTime < c.end_time && c.chord !== 'N'
  )
  if (active?.chord) return active

  for (let i = chords.length - 1; i >= 0; i--) {
    const c = chords[i]
    if (c.chord !== 'N' && currentTime >= c.start_time) return c
  }

  return null
}

describe('filterRealChords', () => {
  it('excludes N (no-chord) entries', () => {
    const chords = [chord('C', 0, 2), chord('N', 2, 3), chord('G', 3, 5)]
    expect(filterRealChords(chords)).toEqual([chord('C', 0, 2), chord('G', 3, 5)])
  })
})

describe('findActiveChordEntry', () => {
  const chords = [chord('C', 0, 2), chord('N', 2, 3.6), chord('G', 3.6, 5.6), chord('Am', 6, 8)]
  const realChords = filterRealChords(chords)

  function find(time: number, cursor = createScanCursor()): ChordEntry | null {
    return findActiveChordEntry(realChords, time, cursor)
  }

  it('returns the chord containing the current time', () => {
    expect(find(0)).toEqual(chord('C', 0, 2))
    expect(find(1.9)).toEqual(chord('C', 0, 2))
    expect(find(4)).toEqual(chord('G', 3.6, 5.6))
  })

  it('falls back to the most recently started real chord during an N gap', () => {
    expect(find(2.5)).toEqual(chord('C', 0, 2))
  })

  it('falls back to the most recently started real chord in an unlabeled gap', () => {
    expect(find(5.9)).toEqual(chord('G', 3.6, 5.6))
  })

  it('returns null before the first chord starts', () => {
    expect(find(-1)).toBe(null)
  })

  it('handles empty input', () => {
    expect(findActiveChordEntry([], 3, createScanCursor())).toBe(null)
  })

  it('matches the reference implementation across a forward sweep', () => {
    const cursor = createScanCursor()
    for (let t = -1; t <= 9; t += 0.1) {
      const rounded = Math.round(t * 10) / 10
      expect(find(rounded, cursor)).toEqual(findDisplayChordReference(chords, rounded))
    }
  })

  it('rescans correctly when time moves backward (a seek)', () => {
    const cursor = createScanCursor()
    expect(find(7.9, cursor)).toEqual(chord('Am', 6, 8))
    expect(find(1, cursor)).toEqual(chord('C', 0, 2))
    expect(find(-5, cursor)).toBe(null)
    expect(find(4, cursor)).toEqual(chord('G', 3.6, 5.6))
  })
})

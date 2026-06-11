import { describe, it, expect } from 'vitest'
import { groupChordsIntoBars } from './bars'
import type { ChordEntry } from '@/types/song'

function chord(start: number, end: number, name: string, bass?: string | null): ChordEntry {
  return { start_time: start, end_time: end, chord: name, bass: bass ?? null }
}

describe('groupChordsIntoBars', () => {
  const barStarts = [0, 2, 4, 6, 8]

  it('places each chord in the bars it sounds in', () => {
    const chords = [
      chord(0, 2, 'C:maj'),
      chord(2, 4, 'G:maj'),
      chord(4, 8, 'A:min'),
    ]
    const bars = groupChordsIntoBars(chords, barStarts, 10)
    expect(bars).toHaveLength(5)
    expect(bars[0].chords.map((c) => c.chord)).toEqual(['C:maj'])
    expect(bars[1].chords.map((c) => c.chord)).toEqual(['G:maj'])
    // A:min spans bars 2 and 3 — shown in both (held chord).
    expect(bars[2].chords.map((c) => c.chord)).toEqual(['A:min'])
    expect(bars[3].chords.map((c) => c.chord)).toEqual(['A:min'])
  })

  it('shows multiple chord changes inside one bar in order', () => {
    const chords = [chord(0, 1, 'C:maj'), chord(1, 2, 'G:maj'), chord(2, 4, 'F:maj')]
    const bars = groupChordsIntoBars(chords, barStarts, 10)
    expect(bars[0].chords.map((c) => c.chord)).toEqual(['C:maj', 'G:maj'])
  })

  it('skips no-chord segments and leaves silent bars empty', () => {
    const chords = [chord(0, 2, 'N'), chord(2, 4, 'C:maj')]
    const bars = groupChordsIntoBars(chords, barStarts, 10)
    expect(bars[0].chords).toEqual([])
    expect(bars[1].chords.map((c) => c.chord)).toEqual(['C:maj'])
  })

  it('bar windows are contiguous and end at the song duration', () => {
    const bars = groupChordsIntoBars([], barStarts, 9.5)
    expect(bars[0]).toMatchObject({ start: 0, end: 2 })
    expect(bars[4]).toMatchObject({ start: 8, end: 9.5 })
  })

  it('returns empty when there is no bar grid', () => {
    expect(groupChordsIntoBars([chord(0, 2, 'C:maj')], [], 10)).toEqual([])
  })
})

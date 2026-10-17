import { describe, expect, it } from 'vitest'

import type { TabRhythm } from '@/types/song'
import { getTabStrumPatterns, recordingAccents, type StrumDirection } from './strum-pattern'

const tab: TabRhythm = {
  beats_per_bar: 4,
  beat_accents: [0, 0.9, 0, 0.9],
  strum_patterns: [{
    name: 'Verse',
    subdivision: 2,
    bar_share: 0.8,
    steps: ['down', 'miss', 'down', 'up', 'miss', 'up', 'down', 'up'].map((direction, i) => ({
      direction: direction as 'down' | 'up' | 'miss',
      accent: i === 2 || i === 6,
    })),
  }],
}
const measured = {
  beats_per_bar: 4,
  steps_per_beat: 2,
  accents: [false, false, true, false, false, true, false, false],
  strength: [0.9, 0.4, 1.2, 0.6, 1.0, 1.24, 1.0, 1.18],
  bars: 100,
}

describe('getTabStrumPatterns', () => {
  it('marks the snare beats without a measurement', () => {
    const [verse] = getTabStrumPatterns(tab)
    expect(verse.accents).toEqual([false, false, true, false, false, false, true, false])
    expect(verse.accentSource).toBe('snare')
  })

  it('prefers the accents measured on the recording when they fit the pattern', () => {
    const [verse] = getTabStrumPatterns(tab, measured)
    expect(verse.accents).toEqual(measured.accents)
    expect(verse.accentSource).toBe('recording')
  })

  it('does not mark a measured accent on a rest of the tab pattern', () => {
    // Accents on beat 2 and on beat 3, which the verse pattern skips.
    const [verse] = getTabStrumPatterns(tab, { ...measured, accents: [false, false, true, false, true, false, false, false] })
    expect(verse.accents).toEqual([false, false, true, false, false, false, false, false])
    expect(verse.accentSource).toBe('recording')
  })
})

describe('recordingAccents', () => {
  const strokes = (count: number): StrumDirection[] => Array.from({ length: count }, () => 'down')
  const eighths = (beatsPerBar: number, on: number[]) => ({
    beats_per_bar: beatsPerBar,
    steps_per_beat: 2,
    accents: Array.from({ length: beatsPerBar * 2 }, (_, i) => on.includes(i)),
    strength: Array.from({ length: beatsPerBar * 2 }, () => 1),
    bars: 50,
  })

  it('lands eighth-note accents on a sixteenth-note pattern', () => {
    // Beat 2 and the "&" of 3 -> sixteenth steps 4 and 10.
    const accents = recordingAccents(eighths(4, [2, 5]), 4, strokes(16), 4)
    expect(accents?.flatMap((on, i) => (on ? [i] : []))).toEqual([4, 10])
  })

  it('keeps only on-beat accents for a pattern of one stroke a beat', () => {
    // Maggie's Farm Forever, measured in 6: beats 1 and 4.
    const accents = recordingAccents(eighths(6, [0, 6]), 6, strokes(6), 1)
    expect(accents).toEqual([true, false, false, true, false, false])
  })

  it('repeats a two-beat measurement across a four-beat bar', () => {
    const accents = recordingAccents(eighths(2, [0]), 4, strokes(8), 2)
    expect(accents).toEqual([true, false, false, false, true, false, false, false])
  })

  it('stays off a bar it does not divide', () => {
    expect(recordingAccents(eighths(3, [0]), 4, strokes(8), 2)).toBeNull()
  })

  it('leaves an accent off a step the pattern does not strum', () => {
    // The "&" of 1 and beat 2; the pattern rests on the "&" of 1.
    const pattern: StrumDirection[] = ['down', 'miss', 'down', 'up', 'miss', 'up', 'down', 'up']
    const accents = recordingAccents(eighths(4, [1, 2]), 4, pattern, 2)
    expect(accents).toEqual([false, false, true, false, false, false, false, false])
  })

  it('is null when every accent falls on a rest', () => {
    const pattern: StrumDirection[] = ['down', 'miss', 'down', 'up', 'miss', 'up', 'down', 'up']
    expect(recordingAccents(eighths(4, [1, 4]), 4, pattern, 2)).toBeNull()
  })

  it('accents a muted chuck like any other stroke', () => {
    const pattern: StrumDirection[] = ['down', 'miss', 'chuck', 'up', 'down', 'up', 'chuck', 'up']
    expect(recordingAccents(eighths(4, [2]), 4, pattern, 2)).toEqual([false, false, true, false, false, false, false, false])
  })
})

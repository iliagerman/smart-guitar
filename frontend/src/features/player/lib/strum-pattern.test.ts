import { describe, it, expect } from 'vitest'
import { getStrumPattern } from './strum-pattern'
import type { StrumEvent } from '@/types/song'

function makeStrum(
  id: number,
  start: number,
  end: number,
  direction: 'down' | 'up' | 'ambiguous',
  confidence = 0.5
): StrumEvent {
  return { id, start_time: start, end_time: end, direction, confidence, num_strings: 0, onset_spread_ms: 0 }
}

describe('getStrumPattern', () => {
  it('returns all matching strums within a chord time range', () => {
    const strums: StrumEvent[] = [
      makeStrum(0, 0.0, 0.5, 'down'),
      makeStrum(1, 0.5, 1.0, 'up'),
      makeStrum(2, 1.0, 1.5, 'down'),
      makeStrum(3, 1.5, 2.0, 'up'),
    ]

    const pattern = getStrumPattern(0.0, 2.0, strums)
    expect(pattern).toHaveLength(4)
    expect(pattern.map(p => p.direction)).toEqual(['down', 'up', 'down', 'up'])
  })

  it('returns only strums within the chord range, not outside', () => {
    const strums: StrumEvent[] = [
      makeStrum(0, 0.0, 0.5, 'down'),
      makeStrum(1, 0.5, 1.0, 'up'),
      makeStrum(2, 1.0, 1.5, 'down'),   // outside chord range [0, 1)
      makeStrum(3, 1.5, 2.0, 'up'),     // outside
    ]

    const pattern = getStrumPattern(0.0, 1.0, strums)
    expect(pattern).toHaveLength(2)
    expect(pattern[0].direction).toBe('down')
    expect(pattern[1].direction).toBe('up')
  })

  it('excludes ambiguous strums', () => {
    const strums: StrumEvent[] = [
      makeStrum(0, 0.0, 0.5, 'down'),
      makeStrum(1, 0.5, 1.0, 'ambiguous'),
      makeStrum(2, 1.0, 1.5, 'up'),
    ]

    const pattern = getStrumPattern(0.0, 2.0, strums)
    expect(pattern).toHaveLength(2)
    expect(pattern[0].direction).toBe('down')
    expect(pattern[1].direction).toBe('up')
  })

  it('returns empty array when no strums match', () => {
    const strums: StrumEvent[] = [
      makeStrum(0, 5.0, 5.5, 'down'),
    ]

    const pattern = getStrumPattern(0.0, 2.0, strums)
    expect(pattern).toHaveLength(0)
  })

  it('returns empty array for empty strums list', () => {
    const pattern = getStrumPattern(0.0, 2.0, [])
    expect(pattern).toHaveLength(0)
  })

  it('includes strums within the 50ms tolerance before chord start', () => {
    const strums: StrumEvent[] = [
      makeStrum(0, 0.97, 1.0, 'down'),  // 30ms before chord start (within 50ms tolerance)
    ]

    const pattern = getStrumPattern(1.0, 2.0, strums)
    expect(pattern).toHaveLength(1)
    expect(pattern[0].direction).toBe('down')
  })

  it('excludes strums beyond the 50ms tolerance before chord start', () => {
    const strums: StrumEvent[] = [
      makeStrum(0, 0.9, 1.0, 'down'),  // 100ms before chord start (beyond 50ms tolerance)
    ]

    const pattern = getStrumPattern(1.0, 2.0, strums)
    expect(pattern).toHaveLength(0)
  })

  it('uses correct symbols for down and up', () => {
    const strums: StrumEvent[] = [
      makeStrum(0, 0.0, 0.5, 'down'),
      makeStrum(1, 0.5, 1.0, 'up'),
    ]

    const pattern = getStrumPattern(0.0, 2.0, strums)
    expect(pattern[0].symbol).toBe('\u2193')
    expect(pattern[1].symbol).toBe('\u2191')
  })

  it('formats confidence percentage in title', () => {
    const strums: StrumEvent[] = [
      makeStrum(0, 0.0, 0.5, 'down', 0.85),
    ]

    const pattern = getStrumPattern(0.0, 2.0, strums)
    expect(pattern[0].title).toBe('down strum (85%)')
  })

  it('handles multiple chords each getting their own subset of strums', () => {
    const strums: StrumEvent[] = [
      makeStrum(0, 0.0, 0.5, 'down'),
      makeStrum(1, 0.5, 1.0, 'up'),
      makeStrum(2, 1.0, 1.5, 'down'),
      makeStrum(3, 1.5, 2.0, 'up'),
      makeStrum(4, 2.0, 2.5, 'down'),
      makeStrum(5, 2.5, 3.0, 'up'),
    ]

    // First chord: [0, 2) should get strums 0-3
    const pattern1 = getStrumPattern(0.0, 2.0, strums)
    expect(pattern1).toHaveLength(4)

    // Second chord: [2, 4) should get strums 4-5
    const pattern2 = getStrumPattern(2.0, 4.0, strums)
    expect(pattern2).toHaveLength(2)
    expect(pattern2[0].direction).toBe('down')
    expect(pattern2[1].direction).toBe('up')
  })

  it('returns D-U-D-U pattern matching beat-aligned generation', () => {
    // Simulates what the backend produces: 4 beats in a chord, alternating D-U
    const strums: StrumEvent[] = [
      makeStrum(0, 1.0, 1.5, 'down', 0.5),
      makeStrum(1, 1.5, 2.0, 'up', 0.5),
      makeStrum(2, 2.0, 2.5, 'down', 0.5),
      makeStrum(3, 2.5, 3.0, 'up', 0.5),
    ]

    const pattern = getStrumPattern(1.0, 3.0, strums)
    expect(pattern).toHaveLength(4)
    expect(pattern.map(p => p.direction)).toEqual(['down', 'up', 'down', 'up'])
    expect(pattern.map(p => p.symbol)).toEqual(['\u2193', '\u2191', '\u2193', '\u2191'])
  })
})

import { describe, it, expect } from 'vitest'
import { getStrumPattern, getSectionStrumPatterns } from './strum-pattern'
import type { RhythmInfo, SongSection, StrumEvent } from '@/types/song'

function makeStrum(
  id: number,
  start: number,
  end: number,
  direction: 'down' | 'up' | 'ambiguous',
  confidence = 0.5
): StrumEvent {
  return { id, start_time: start, end_time: end, direction, confidence, num_strings: 4, onset_spread_ms: 0 }
}

describe('getStrumPattern', () => {
  const rhythm: RhythmInfo = {
    bpm: 120,
    beat_times: [0.0, 0.5, 1.0, 1.5, 2.0, 2.5],
  }

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

  it('returns D-U-D-U pattern with rhythm grid', () => {
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

  it('uses rhythm grid for quantized display when available', () => {
    const strums: StrumEvent[] = [
      makeStrum(0, 0.0, 0.5, 'down', 0.82),
      makeStrum(1, 0.5, 1.0, 'up', 0.75),
    ]

    const pattern = getStrumPattern(0.0, 1.0, strums, { rhythm })
    expect(pattern.length).toBeGreaterThan(0)
    expect(pattern[0].direction).toBe('down')
  })
})

describe('getSectionStrumPatterns — direction locked to beat grid', () => {
  function makeSection(name: string, pattern: ('down' | 'up' | 'miss')[]): SongSection {
    return { name, start_time: 0, end_time: 10, strum_pattern: pattern, llm_pattern: pattern }
  }

  it('locks eighth-note directions to the grid: down on counts, up on offbeats', () => {
    // Stored pattern is physically backwards (down on the &, up on beat 2).
    const sections = [makeSection('Verse', ['down', 'down', 'up', 'up', 'down', 'up', 'miss', 'down'])]
    const [sp] = getSectionStrumPatterns(sections)
    expect(sp.pattern.map(s => s.direction)).toEqual(
      ['down', 'up', 'down', 'up', 'down', 'up', 'miss', 'up'],
    )
  })

  it('preserves miss positions while normalizing struck directions', () => {
    // Struck directions are backwards; misses sit on a count (idx 0) and an offbeat (idx 3).
    const sections = [makeSection('Chorus', ['miss', 'down', 'up', 'miss', 'up', 'down', 'up', 'down'])]
    const [sp] = getSectionStrumPatterns(sections)
    expect(sp.pattern.map(s => s.direction)).toEqual(
      ['miss', 'up', 'down', 'miss', 'down', 'up', 'down', 'up'],
    )
  })

  it('renders quarter-note patterns (<=4 steps) as all downstrokes', () => {
    const sections = [makeSection('Verse', ['down', 'up', 'down', 'up'])]
    const [sp] = getSectionStrumPatterns(sections)
    expect(sp.pattern.map(s => s.direction)).toEqual(['down', 'down', 'down', 'down'])
  })

  it('alternates down/up across a sixteenth-note (16-step) pattern', () => {
    const sixteen = Array.from({ length: 16 }, () => 'down' as const)
    const [sp] = getSectionStrumPatterns([makeSection('Verse', sixteen)])
    const expected = Array.from({ length: 16 }, (_, i) => (i % 2 === 0 ? 'down' : 'up'))
    expect(sp.pattern.map(s => s.direction)).toEqual(expected)
  })

  it('maps counts to ↓ and offbeats to ↑ in the rendered symbols', () => {
    const allDown = ['down', 'down', 'down', 'down', 'down', 'down', 'down', 'down'] as const
    const [sp] = getSectionStrumPatterns([makeSection('Verse', [...allDown])])
    expect(sp.pattern.map(s => s.symbol)).toEqual(
      ['↓', '↑', '↓', '↑', '↓', '↑', '↓', '↑'],
    )
  })
})

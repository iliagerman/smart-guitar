import { describe, it, expect } from 'vitest'
import { createScanCursor } from '../lib/cursor-scan'
import { computeActiveLineIndex } from './use-tabs-sheet-sync'

interface Line {
  startTime: number
  endTime: number
}

function find(lines: Line[], time: number, cursor = createScanCursor()): number {
  return computeActiveLineIndex(lines, time, cursor)
}

describe('computeActiveLineIndex', () => {
  // Gaps: [0,2) then a 1.6s gap, then [3.6, 5.6), then a 0.4s gap, then [6, 8).
  const lines: Line[] = [
    { startTime: 0, endTime: 2 },
    { startTime: 3.6, endTime: 5.6 },
    { startTime: 6, endTime: 8 },
  ]

  it('selects the line containing the time', () => {
    expect(find(lines, 0)).toBe(0)
    expect(find(lines, 1.9)).toBe(0)
    expect(find(lines, 4)).toBe(1)
    expect(find(lines, 7.9)).toBe(2)
  })

  it('returns -1 before the first line starts (outside the lookahead window)', () => {
    expect(find(lines, -1)).toBe(-1)
  })

  it('looks ahead to the first line just before it starts', () => {
    // NEXT_LINE_LOOKAHEAD_S is 0.5.
    expect(find(lines, -0.3)).toBe(0)
  })

  it('lingers on the previous line right after it ends (gap < linger window)', () => {
    // PREV_LINE_LINGER_S is 0.8.
    expect(find(lines, 2.5)).toBe(0)
  })

  it('returns -1 in the dead zone of a long gap (past linger, before lookahead)', () => {
    // Gap from 2 to 3.6 is 1.6s — past the 0.8s linger and the 0.5s lookahead
    // to the next line (which starts at 3.6) at times like 2.9.
    expect(find(lines, 2.9)).toBe(-1)
  })

  it('looks ahead to the next line shortly before it starts', () => {
    // 3.6 - 0.4 = 3.2, within the 0.5s lookahead window.
    expect(find(lines, 3.3)).toBe(1)
  })

  it('lingers through a short gap (linger window covers the whole gap)', () => {
    // Gap between line 1 (ends 5.6) and line 2 (starts 6) is only 0.4s —
    // fully inside the 0.8s linger window, so it lingers the whole way.
    expect(find(lines, 5.7)).toBe(1)
    expect(find(lines, 5.9)).toBe(1)
  })

  it('clears well after the last line ends, past the linger window', () => {
    expect(find(lines, 8.9)).toBe(-1)
    expect(find(lines, 100)).toBe(-1)
  })

  it('handles empty input', () => {
    expect(find([], 3)).toBe(-1)
  })

  it('advances forward across repeated calls sharing a cursor, matching independent calls', () => {
    const cursor = createScanCursor()
    const times = [-1, -0.3, 0, 1.9, 2.5, 2.9, 3.3, 4, 5.7, 5.9, 7.9, 8, 100]
    for (const t of times) {
      expect(find(lines, t, cursor)).toBe(find(lines, t))
    }
  })

  it('rescans correctly when time moves backward (a seek)', () => {
    const cursor = createScanCursor()
    expect(find(lines, 7.9, cursor)).toBe(2)
    expect(find(lines, 1, cursor)).toBe(0)
    expect(find(lines, -5, cursor)).toBe(-1)
    expect(find(lines, 4, cursor)).toBe(1)
  })
})

import { describe, it, expect } from 'vitest'
import { findActiveTimedIndex } from './active-timed-index'

interface Timed {
  start: number
  end: number
}

function find(items: Timed[], time: number): number {
  return findActiveTimedIndex(
    items.length,
    time,
    (i) => items[i].start,
    (i) => items[i].end,
  )
}

describe('findActiveTimedIndex', () => {
  const clean: Timed[] = [
    { start: 0, end: 2 },
    { start: 3, end: 5 },
    { start: 6, end: 8 },
  ]

  it('returns -1 before the first item starts', () => {
    expect(find(clean, -1)).toBe(-1)
  })

  it('selects the item containing the time', () => {
    expect(find(clean, 0)).toBe(0)
    expect(find(clean, 1.5)).toBe(0)
    expect(find(clean, 4)).toBe(1)
    expect(find(clean, 7.9)).toBe(2)
  })

  it('keeps the previous item active during a gap', () => {
    expect(find(clean, 2.5)).toBe(0)
    expect(find(clean, 5.5)).toBe(1)
  })

  it('clears after the last item ends', () => {
    expect(find(clean, 8)).toBe(-1)
    expect(find(clean, 100)).toBe(-1)
  })

  it('never moves backward as time advances, even with overlapping data', () => {
    // Corrupted data shaped like the old LLM-merged lyrics: overlapping
    // and out-of-order boundaries.
    const corrupt: Timed[] = [
      { start: 0, end: 5 },
      { start: 2.5, end: 8 },   // overlaps previous
      { start: 7, end: 6.5 },   // inverted times
      { start: 9, end: 12 },
    ]
    let prev = -1
    for (let t = 0; t <= 12; t += 0.1) {
      const idx = find(corrupt, t)
      if (idx >= 0) {
        expect(idx).toBeGreaterThanOrEqual(prev)
        prev = idx
      }
    }
  })

  it('selects the most recently started item when items overlap', () => {
    const overlapping: Timed[] = [
      { start: 0, end: 5 },
      { start: 2.5, end: 8 },
    ]
    expect(find(overlapping, 1)).toBe(0)
    expect(find(overlapping, 3)).toBe(1)
    expect(find(overlapping, 7)).toBe(1)
  })

  it('handles empty input', () => {
    expect(find([], 3)).toBe(-1)
  })
})

import { describe, it, expect } from 'vitest'
import {
  createScanCursor,
  scanForwardActiveTimedIndex,
  scanForwardMostRecentStarted,
} from './cursor-scan'

interface Timed {
  start: number
  end: number
}

describe('scanForwardActiveTimedIndex', () => {
  const clean: Timed[] = [
    { start: 0, end: 2 },
    { start: 3, end: 5 },
    { start: 6, end: 8 },
  ]

  function find(items: Timed[], time: number, cursor = createScanCursor()) {
    return scanForwardActiveTimedIndex(
      items.length,
      time,
      (i) => items[i].start,
      (i) => items[i].end,
      cursor,
    )
  }

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

  it('handles empty input', () => {
    expect(find([], 3)).toBe(-1)
  })

  it('advances forward across repeated calls sharing a cursor, matching a full scan', () => {
    const cursor = createScanCursor()
    const times = [0, 0.5, 1.9, 3, 4.4, 5.9, 6, 7.9, 8, 9]
    for (const t of times) {
      expect(find(clean, t, cursor)).toBe(find(clean, t))
    }
  })

  it('rescans correctly when time moves backward (a seek)', () => {
    const cursor = createScanCursor()
    expect(find(clean, 7.9, cursor)).toBe(2)
    // Seek back into the first item.
    expect(find(clean, 1, cursor)).toBe(0)
    // Seek back further, before all items.
    expect(find(clean, -5, cursor)).toBe(-1)
    // Resume forward playback.
    expect(find(clean, 4, cursor)).toBe(1)
  })

  it('resets correctly when the underlying data changes (new cursor)', () => {
    const cursor = createScanCursor()
    expect(find(clean, 7.9, cursor)).toBe(2)

    const shorter: Timed[] = [{ start: 0, end: 1 }]
    const freshCursor = createScanCursor()
    expect(find(shorter, 0.5, freshCursor)).toBe(0)
  })
})

describe('scanForwardMostRecentStarted', () => {
  const items: Timed[] = [
    { start: 0, end: 2 },
    { start: 3, end: 5 },
    { start: 6, end: 8 },
  ]

  function find(list: Timed[], time: number, cursor = createScanCursor()) {
    return scanForwardMostRecentStarted(list.length, time, (i) => list[i].start, cursor)
  }

  it('returns -1 before the first item starts', () => {
    expect(find(items, -1)).toBe(-1)
  })

  it('never expires — stays on the last item after it ends', () => {
    expect(find(items, 100)).toBe(2)
  })

  it('advances forward across repeated calls sharing a cursor, matching a full scan', () => {
    const cursor = createScanCursor()
    const times = [0, 1, 3, 4, 6, 100]
    for (const t of times) {
      expect(find(items, t, cursor)).toBe(find(items, t))
    }
  })

  it('rescans correctly when time moves backward (a seek)', () => {
    const cursor = createScanCursor()
    expect(find(items, 100, cursor)).toBe(2)
    expect(find(items, 1, cursor)).toBe(0)
    expect(find(items, -5, cursor)).toBe(-1)
  })

  it('handles empty input', () => {
    expect(find([], 3)).toBe(-1)
  })
})

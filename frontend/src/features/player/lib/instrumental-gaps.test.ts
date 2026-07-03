import { describe, it, expect } from 'vitest'
import {
  computeInstrumentalGaps,
  getSkipTarget,
  MIN_INSTRUMENTAL_GAP_SECONDS,
  INSTRUMENTAL_SKIP_GRACE_SECONDS,
  INSTRUMENTAL_SKIP_PREROLL_SECONDS,
} from './instrumental-gaps'

describe('computeInstrumentalGaps', () => {
  it('returns no gaps for an empty segment list', () => {
    expect(computeInstrumentalGaps([], MIN_INSTRUMENTAL_GAP_SECONDS)).toEqual([])
  })

  it('finds a gap between two segments longer than the threshold', () => {
    const segments = [
      { start: 0, end: 2 },
      { start: 11, end: 14 },
    ]
    expect(computeInstrumentalGaps(segments, 7)).toEqual([{ start: 2, end: 11 }])
  })

  it('does not report a gap exactly equal to the threshold', () => {
    const segments = [
      { start: 0, end: 2 },
      { start: 9, end: 12 },
    ]
    expect(computeInstrumentalGaps(segments, 7)).toEqual([])
  })

  it('does not report a gap shorter than the threshold', () => {
    const segments = [
      { start: 0, end: 2 },
      { start: 7, end: 9 },
    ]
    expect(computeInstrumentalGaps(segments, 7)).toEqual([])
  })

  it('includes a long intro gap before the first segment', () => {
    const segments = [{ start: 10, end: 12 }]
    expect(computeInstrumentalGaps(segments, 7)).toEqual([{ start: 0, end: 10 }])
  })

  it('does not include a short intro gap', () => {
    const segments = [{ start: 3, end: 5 }]
    expect(computeInstrumentalGaps(segments, 7)).toEqual([])
  })

  it('never reports an outro gap after the last segment', () => {
    const segments = [
      { start: 0, end: 2 },
      { start: 5, end: 200 },
    ]
    expect(computeInstrumentalGaps(segments, 7)).toEqual([])
  })

  it('sorts unsorted segments before computing gaps', () => {
    const segments = [
      { start: 11, end: 14 },
      { start: 0, end: 2 },
    ]
    expect(computeInstrumentalGaps(segments, 7)).toEqual([{ start: 2, end: 11 }])
  })

  it('merges overlapping segments before computing gaps', () => {
    const segments = [
      { start: 0, end: 5 },
      { start: 3, end: 8 },
      { start: 20, end: 22 },
    ]
    expect(computeInstrumentalGaps(segments, 7)).toEqual([{ start: 8, end: 20 }])
  })
})

describe('getSkipTarget', () => {
  const gaps = [{ start: 10, end: 20 }]
  const opts = { graceSeconds: 1, preRollSeconds: 1.5 }

  it('returns null when current time is before the gap', () => {
    expect(getSkipTarget(gaps, 5, opts)).toBeNull()
  })

  it('returns null while still within the grace period at the start of the gap', () => {
    expect(getSkipTarget(gaps, 10.5, opts)).toBeNull()
  })

  it('returns the pre-roll target once past the grace period', () => {
    expect(getSkipTarget(gaps, 11, opts)).toBe(18.5)
  })

  it('returns null once current time has passed the pre-roll landing point', () => {
    expect(getSkipTarget(gaps, 19, opts)).toBeNull()
  })

  it('returns null for an empty gap list', () => {
    expect(getSkipTarget([], 50, opts)).toBeNull()
  })

  it('does not re-trigger when landed exactly on the pre-roll target (no seek thrash)', () => {
    const target = getSkipTarget(gaps, 11, opts)
    expect(target).not.toBeNull()
    expect(getSkipTarget(gaps, target as number, opts)).toBeNull()
  })

  it('uses the exported default constants together to compute a real gap skip', () => {
    const segments = [
      { start: 0, end: 2 },
      { start: 11, end: 14 },
    ]
    const detectedGaps = computeInstrumentalGaps(segments, MIN_INSTRUMENTAL_GAP_SECONDS)
    const target = getSkipTarget(detectedGaps, 3, {
      graceSeconds: INSTRUMENTAL_SKIP_GRACE_SECONDS,
      preRollSeconds: INSTRUMENTAL_SKIP_PREROLL_SECONDS,
    })
    expect(target).toBe(11 - INSTRUMENTAL_SKIP_PREROLL_SECONDS)
  })
})

describe('getSkipTarget with a suppressed gap', () => {
  // A user who deliberately scrubs into the middle of a gap should not be
  // yanked back out — suppression is identified by the gap's start time.
  const gaps = [
    { start: 10, end: 20 },
    { start: 30, end: 40 },
  ]
  const opts = { graceSeconds: 1, preRollSeconds: 1.5 }

  it('does not skip the gap the caller has marked as suppressed', () => {
    expect(getSkipTarget(gaps, 11, opts, 10)).toBeNull()
  })

  it('still skips other gaps while one is suppressed', () => {
    expect(getSkipTarget(gaps, 31, opts, 10)).toBe(38.5)
  })

  it('has no effect once current time is outside the suppressed gap entirely', () => {
    expect(getSkipTarget(gaps, 25, opts, 10)).toBeNull()
  })

  it('treats a missing or null suppressedGapStart as nothing suppressed', () => {
    expect(getSkipTarget(gaps, 11, opts)).toBe(18.5)
    expect(getSkipTarget(gaps, 11, opts, null)).toBe(18.5)
  })
})

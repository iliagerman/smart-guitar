/** A sung lyrics segment with a start/end time in seconds. */
export interface LyricsTimeSegment {
  start: number
  end: number
}

/** A stretch of playback with no vocals, in seconds. */
export interface InstrumentalGap {
  start: number
  end: number
}

export interface SkipTargetOptions {
  /** Seconds a gap must already be playing into before a skip is allowed. */
  graceSeconds: number
  /** Seconds to land before the next sung segment, so the skip doesn't feel abrupt. */
  preRollSeconds: number
}

/** Minimum length (seconds) a silent stretch must exceed to count as skippable. */
export const MIN_INSTRUMENTAL_GAP_SECONDS = 7
/** How far into a gap playback must be before a skip triggers. */
export const INSTRUMENTAL_SKIP_GRACE_SECONDS = 1.0
/** How far before the next sung segment a skip lands. */
export const INSTRUMENTAL_SKIP_PREROLL_SECONDS = 1.5

/** Sorts segments by start time and merges any that overlap. */
function normalizeSegments(segments: LyricsTimeSegment[]): LyricsTimeSegment[] {
  if (segments.length === 0) return []
  const sorted = [...segments].sort((a, b) => a.start - b.start)
  const merged: LyricsTimeSegment[] = [{ ...sorted[0] }]
  for (const segment of sorted.slice(1)) {
    const last = merged[merged.length - 1]
    if (segment.start <= last.end) {
      last.end = Math.max(last.end, segment.end)
    } else {
      merged.push({ ...segment })
    }
  }
  return merged
}

/**
 * Finds stretches of playback with no vocals that are strictly longer than
 * `minGapSeconds` — candidates for auto-skip during practice. Includes the
 * intro (before the first sung segment) but never an outro gap, since
 * there's nothing left to skip to after the last segment.
 */
export function computeInstrumentalGaps(
  segments: LyricsTimeSegment[],
  minGapSeconds: number,
): InstrumentalGap[] {
  const normalized = normalizeSegments(segments)
  if (normalized.length === 0) return []

  const gaps: InstrumentalGap[] = []

  if (normalized[0].start > minGapSeconds) {
    gaps.push({ start: 0, end: normalized[0].start })
  }

  for (let i = 0; i < normalized.length - 1; i++) {
    const gapLength = normalized[i + 1].start - normalized[i].end
    if (gapLength > minGapSeconds) {
      gaps.push({ start: normalized[i].end, end: normalized[i + 1].start })
    }
  }

  return gaps
}

/**
 * Returns the time to seek to when playback is inside a skippable gap past
 * its grace period, or null when no skip should happen yet. The clamp to
 * `> currentTime` ensures the landing spot (just before the gap's end)
 * can't re-trigger another skip on the very next check.
 *
 * `suppressedGapStart` identifies a gap (by its start time) that must never
 * be auto-skipped — used when a user has deliberately scrubbed into it and
 * wants to listen to it, rather than being yanked back out.
 */
export function getSkipTarget(
  gaps: InstrumentalGap[],
  currentTime: number,
  opts: SkipTargetOptions,
  suppressedGapStart?: number | null,
): number | null {
  const gap = gaps.find(
    (g) => currentTime >= g.start + opts.graceSeconds && currentTime < g.end,
  )
  if (!gap) return null
  if (suppressedGapStart != null && gap.start === suppressedGapStart) return null

  const target = gap.end - opts.preRollSeconds
  return target > currentTime ? target : null
}

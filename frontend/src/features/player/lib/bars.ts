import type { ChordEntry } from '@/types/song'

export interface Bar {
  /** Bar (measure) time window in the audio timebase. */
  start: number
  end: number
  /** Chords sounding in this bar, in playing order (held chords repeat). */
  chords: ChordEntry[]
}

/**
 * Group the chord timeline into measures using the beat-detected bar grid.
 * A chord appears in every bar it overlaps, so held chords repeat across
 * bars the way a player reads them; "N" (no chord) segments are skipped.
 */
export function groupChordsIntoBars(
  chords: ChordEntry[],
  barStarts: number[],
  duration: number,
): Bar[] {
  if (barStarts.length === 0) return []

  const bars: Bar[] = barStarts.map((start, i) => ({
    start,
    end: i + 1 < barStarts.length ? barStarts[i + 1] : Math.max(duration, start),
    chords: [],
  }))

  for (const c of chords) {
    if (c.chord === 'N') continue
    for (const bar of bars) {
      const overlap = Math.min(c.end_time, bar.end) - Math.max(c.start_time, bar.start)
      if (overlap > 0.05) {
        bar.chords.push(c)
      }
    }
  }
  return bars
}

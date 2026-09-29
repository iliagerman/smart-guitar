/** The stretch of the song's beat grid a chord is held for. */
export interface ChordBeats {
  /** Index of the chord's first beat in the song's beat grid. */
  first: number
  count: number
}

/** Index of the detected beat nearest to `time`. */
export function nearestBeatIndex(beatTimes: readonly number[], time: number): number {
  let low = 0
  let high = beatTimes.length - 1
  while (low < high) {
    const middle = (low + high) >> 1
    if (beatTimes[middle] < time) low = middle + 1
    else high = middle
  }
  return low > 0 && time - beatTimes[low - 1] <= beatTimes[low] - time ? low - 1 : low
}

/**
 * The beats a chord is held for: its start and end snapped to the nearest
 * detected beats. Null when the song has no beat grid or the chord is outside it.
 */
export function chordBeats(beatTimes: readonly number[] | null | undefined, start: number, end: number): ChordBeats | null {
  if (!beatTimes || beatTimes.length < 2 || !(end > start)) return null
  if (end <= beatTimes[0] || start >= beatTimes[beatTimes.length - 1]) return null
  const first = nearestBeatIndex(beatTimes, start)
  return { first, count: Math.max(1, nearestBeatIndex(beatTimes, end) - first) }
}

/** "1 beat", "3 beats", "1 bar", "2½ bars". */
export function holdLabel(beats: number, beatsPerBar: number): string {
  if (beats < beatsPerBar) return `${beats} ${beats === 1 ? 'beat' : 'beats'}`
  const halves = Math.round((beats / beatsPerBar) * 2)
  const whole = Math.floor(halves / 2)
  const bars = `${whole > 0 ? whole : ''}${halves % 2 ? '½' : ''}`
  return `${bars} ${halves === 2 ? 'bar' : 'bars'}`
}

/**
 * The count drawn under a chord: one number per beat it's held ("1 2 3").
 * A hold longer than a bar counts one bar and says how many bars ("2", "1½").
 * It counts from the change, not from the bar line, so a grid whose bar lines
 * are off still counts the hold right.
 */
export function beatCount(beats: ChordBeats, beatsPerBar: number): { counts: number[]; bars: string | null } {
  const repeat = beats.count > beatsPerBar
  const counts = Array.from({ length: repeat ? beatsPerBar : beats.count }, (_, i) => i + 1)
  if (!repeat) return { counts, bars: null }
  const halves = Math.round((beats.count / beatsPerBar) * 2)
  return { counts, bars: `${Math.floor(halves / 2) || ''}${halves % 2 ? '½' : ''}` }
}

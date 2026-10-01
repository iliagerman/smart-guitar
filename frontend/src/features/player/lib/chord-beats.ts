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
 * The beats a chord is held for: its start and end snapped to the nearest half
 * bar (the nearest beat in odd meters). Detected chord changes land a little
 * early or late, and players count chords in half bars. Null when the song has
 * no beat grid or the chord is outside it.
 */
export function chordBeats(
  beatTimes: readonly number[] | null | undefined,
  start: number,
  end: number,
  beatsPerBar = 4,
): ChordBeats | null {
  if (!beatTimes || beatTimes.length < 2 || !(end > start)) return null
  if (end <= beatTimes[0] || start >= beatTimes[beatTimes.length - 1]) return null
  // The grid's first beat is a downbeat, so half bars fall on multiples of `unit`.
  const unit = beatsPerBar % 2 === 0 ? beatsPerBar / 2 : 1
  const snap = (time: number) => Math.round(nearestBeatIndex(beatTimes, time) / unit) * unit
  const first = snap(start)
  return { first, count: Math.max(unit, snap(end) - first) }
}

/** How long to hold a chord, as a player says it: "½ bar", "1 bar", "2 bars", or "3 beats" when it's not a half. */
export function holdLabel(beats: number, beatsPerBar: number): string {
  if (beats * 2 === beatsPerBar) return '½ bar'
  if (beats < beatsPerBar) return `${beats} ${beats === 1 ? 'beat' : 'beats'}`
  const halves = Math.round((beats / beatsPerBar) * 2)
  const whole = Math.floor(halves / 2)
  const bars = `${whole > 0 ? whole : ''}${halves % 2 ? '½' : ''}`
  return `${bars} ${halves === 2 ? 'bar' : 'bars'}`
}

import type { ChordEntry } from '@/types/song'

/** The stretch of the song's beat grid a chord is held for. */
export interface ChordBeats {
  /** Index of the chord's first beat in the song's beat grid. */
  first: number
  count: number
}

/** A chord as the sheet shows it on the beat grid: never longer than the bar it sits in. */
export interface BarChord extends ChordEntry {
  hold?: ChordBeats
  /** The same chord carried on from the bar before. */
  continued?: boolean
  /** Starts on a bar line. */
  barStart?: boolean
}

const NO_CHORD = 'N'

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

interface Segment {
  /** Null for silence: no chord, a gap between chords, or a chord off the grid. */
  chord: ChordEntry | null
  start: number
}

/**
 * The chords laid out on the beat grid so every bar adds up to exactly one bar.
 *
 * Changes snap to the nearest half bar (the nearest beat in odd meters), or to
 * a single beat when two changes would land on the same half bar, and each
 * chord then starts on its beat. Silences start and end on bar lines, so a bar
 * is either all chords or all silence. A chord held across a bar line is split
 * there, the later part marked `continued`. Chords off the grid come back as
 * they were, without a hold.
 */
export function splitIntoBars(
  chords: readonly ChordEntry[],
  beatTimes: readonly number[] | null | undefined,
  beatsPerBar = 4,
): BarChord[] {
  if (!beatTimes || beatTimes.length < 2 || beatsPerBar < 1) return [...chords]
  const last = beatTimes.length - 1
  const beatLength = (beatTimes[last] - beatTimes[0]) / last
  const sorted = [...chords].sort((a, b) => a.start_time - b.start_time)
  const onGrid = (c: ChordEntry) =>
    c.chord !== NO_CHORD && c.end_time > c.start_time && c.end_time > beatTimes[0] && c.start_time < beatTimes[last]

  const segments: Segment[] = []
  const silence = (start: number) => {
    if (segments.length > 0 && segments[segments.length - 1].chord) segments.push({ chord: null, start })
  }
  let previousEnd: number | null = null
  for (const chord of sorted) {
    if (!onGrid(chord)) {
      silence(chord.start_time)
      continue
    }
    if (previousEnd !== null && chord.start_time - previousEnd > beatLength) silence(previousEnd)
    segments.push({ chord, start: chord.start_time })
    previousEnd = chord.end_time
  }
  if (previousEnd !== null) silence(previousEnd)

  const unit = beatsPerBar % 2 === 0 ? beatsPerBar / 2 : 1
  const snap = (time: number, step: number) => Math.round(nearestBeatIndex(beatTimes, time) / step) * step
  const bounds: number[] = []
  for (let i = 0; i < segments.length; i++) {
    const { chord, start } = segments[i]
    const before = segments[i - 1]
    let beat = !chord || !before?.chord ? snap(start, beatsPerBar) : snap(start, unit)
    const previous = bounds[i - 1]
    if (previous !== undefined && beat <= previous) {
      // A silence may vanish; a chord keeps at least one beat.
      if (!before.chord) beat = previous
      else if (!chord) beat = (Math.floor(previous / beatsPerBar) + 1) * beatsPerBar
      else beat = Math.max(nearestBeatIndex(beatTimes, start), previous + 1)
    }
    bounds.push(beat)
  }

  const timeAt = (beat: number) =>
    beat <= last ? beatTimes[beat] : beatTimes[last] + (beat - last) * (beatTimes[last] - beatTimes[last - 1])
  const laidOut: BarChord[] = sorted.filter((c) => !onGrid(c))
  segments.forEach(({ chord }, i) => {
    if (!chord) return
    const end = bounds[i + 1]
    for (let first = bounds[i]; first < end; ) {
      const next = Math.min(end, (Math.floor(first / beatsPerBar) + 1) * beatsPerBar)
      laidOut.push({
        ...chord,
        start_time: timeAt(first),
        end_time: timeAt(next),
        hold: { first, count: next - first },
        continued: first !== bounds[i],
        barStart: first % beatsPerBar === 0,
      })
      first = next
    }
  })
  return laidOut.sort((a, b) => a.start_time - b.start_time)
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

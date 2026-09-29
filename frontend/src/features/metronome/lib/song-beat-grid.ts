import type { SongDetail } from '@/types/song'

/** Song tempo: measured from the recording's beats, else the tab tempo, else the guitar-stem estimate. */
export function songTempoBpm(detail: Pick<SongDetail, 'detected_bpm' | 'source_bpm' | 'rhythm'>): number | null {
  return detail.detected_bpm ?? detail.source_bpm ?? detail.rhythm?.bpm ?? null
}

/** Beats detected in the recording (the first is a downbeat), or null when none were detected. */
export function songBeatTimes(detail: Pick<SongDetail, 'beat_times'>): number[] | null {
  return detail.beat_times?.length ? detail.beat_times : null
}

/** Index of the beat sounding at `time`, or null outside the detected beats. */
export function beatIndexAt(beatTimes: readonly number[], time: number): number | null {
  const last = beatTimes.length - 1
  if (time < beatTimes[0] || time >= beatTimes[last]) return null

  let low = 0
  let high = last
  while (high - low > 1) {
    const middle = (low + high) >> 1
    if (beatTimes[middle] <= time) low = middle
    else high = middle
  }
  return low
}

/**
 * Song time of half-beat `n` (even numbers are beats): on the detected beats
 * when there are any, else on a fixed tempo from 0:00. Null once the detected
 * beats are over.
 */
export function subdivisionTime(beatTimes: readonly number[] | null, bpm: number, n: number): number | null {
  if (!beatTimes) return n * (30 / bpm)
  const beat = n >> 1
  if (beat >= beatTimes.length - 1) return null
  return n % 2 === 0 ? beatTimes[beat] : (beatTimes[beat] + beatTimes[beat + 1]) / 2
}

/** The first half-beat at or after `time`, or null once the detected beats are over. */
export function firstSubdivisionFrom(beatTimes: readonly number[] | null, bpm: number, time: number): number | null {
  if (!beatTimes) return Math.max(0, Math.ceil(time / (30 / bpm) - 1e-9))
  if (beatTimes.length < 2) return null
  if (time <= beatTimes[0]) return 0
  const beat = beatIndexAt(beatTimes, time)
  if (beat === null) return null
  for (let n = beat * 2; n <= beat * 2 + 2; n++) {
    const at = subdivisionTime(beatTimes, bpm, n)
    if (at === null) return null
    if (at >= time) return n
  }
  return null
}

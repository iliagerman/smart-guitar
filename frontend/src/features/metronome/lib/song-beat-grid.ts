import type { SongDetail } from '@/types/song'

export interface GridPosition {
  subdivisionNumber: number
  secondsAfterSubdivision: number
}

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

/** Half-beat position of `time` on the grid, or null outside the detected beats. */
export function gridSubdivisionAt(beatTimes: readonly number[], time: number): GridPosition | null {
  const beat = beatIndexAt(beatTimes, time)
  if (beat === null) return null

  const halfBeat = (beatTimes[beat + 1] - beatTimes[beat]) / 2
  const offset = time - beatTimes[beat]
  const half = offset >= halfBeat ? 1 : 0
  return { subdivisionNumber: beat * 2 + half, secondsAfterSubdivision: offset - half * halfBeat }
}

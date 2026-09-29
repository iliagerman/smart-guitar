import { useCallback, useEffect, useRef, useState } from 'react'
import type { BeatEmphasis } from '../lib/beat-emphasis'
import { playMetronomeClick, resumeMetronomeAudio } from '../lib/metronome-audio'
import { firstSubdivisionFrom, subdivisionTime } from '../lib/song-beat-grid'

export type MetronomeMode = 'standalone' | 'playback'

interface UseMetronomeOptions {
  bpm: number
  beatsPerBar: number
  /** Click strength for each beat of the bar (see beatEmphases). */
  emphases: readonly BeatEmphasis[]
  enabled: boolean
  soundEnabled: boolean
  volume: number
  mode: MetronomeMode
  playbackTime?: number
  playbackPlaying?: boolean
  playbackRate?: number
  /** Detected song beats (first is a downbeat); playback clicks follow them instead of a fixed tempo. */
  beatTimes?: readonly number[] | null
}

/** Sounds `n` (a half-beat number) `delaySeconds` from now. */
type ScheduleSubdivision = (subdivisionNumber: number, delaySeconds: number) => void

interface MetronomeClockOptions {
  bpm: number
  enabled: boolean
  mode: MetronomeMode
  schedule: ScheduleSubdivision
  cancelScheduled: () => void
}

interface PlaybackClockOptions extends MetronomeClockOptions {
  playbackTime: number
  playbackPlaying: boolean
  playbackRate: number
  beatTimes: readonly number[] | null
}

interface UseMetronomeResult {
  beat: number
  subdivision: number
  triggerClick: () => void
}

/*
 * Clicks are scheduled ahead on the audio clock (the timers only decide what to
 * schedule next), so they land exactly on the beat however busy the page is.
 */
const SCHEDULER_INTERVAL_MS = 25
const LOOKAHEAD_S = 0.2
/** A half-beat this late (timers throttled in a background tab) is skipped, not played in a burst. */
const STALE_S = 0.03
/** The song clock moved by more than this: a seek, so rebuild the schedule. */
const RESYNC_S = 0.08

function safeBpm(bpm: number): number {
  if (!Number.isFinite(bpm)) return 120
  return Math.max(40, Math.min(240, Math.round(bpm)))
}

const nowSeconds = () => performance.now() / 1000

function useStandaloneClock({ bpm, enabled, mode, schedule, cancelScheduled }: MetronomeClockOptions): void {
  useEffect(() => {
    if (!enabled || mode !== 'standalone') return

    const interval = 30 / safeBpm(bpm)
    const startedAt = nowSeconds()
    let next = 0
    const pump = () => {
      const now = nowSeconds()
      for (let at = startedAt + next * interval; at < now + LOOKAHEAD_S; at = startedAt + next * interval) {
        if (at >= now - STALE_S) schedule(next, at - now)
        next += 1
      }
    }
    pump()
    const timer = window.setInterval(pump, SCHEDULER_INTERVAL_MS)

    return () => {
      window.clearInterval(timer)
      cancelScheduled()
    }
  }, [bpm, enabled, mode, schedule, cancelScheduled])
}

interface SongClock {
  /** Song seconds = performance seconds × rate + offset. */
  offset: number
  rate: number
}

function usePlaybackClock({
  bpm,
  enabled,
  mode,
  schedule,
  cancelScheduled,
  playbackTime,
  playbackPlaying,
  playbackRate,
  beatTimes,
}: PlaybackClockOptions): void {
  const clockRef = useRef<SongClock | null>(null)
  const nextRef = useRef<number | null>(null)
  const active = enabled && mode === 'playback' && playbackPlaying

  // Playback time arrives in coarse, slightly late steps. Each step can only be
  // late, so the largest offset seen is the truest song clock; a jump is a seek.
  useEffect(() => {
    if (!active) return
    const offset = playbackTime - nowSeconds() * playbackRate
    const clock = clockRef.current
    if (!clock || clock.rate !== playbackRate || Math.abs(offset - clock.offset) > RESYNC_S) {
      if (clock) {
        cancelScheduled()
        nextRef.current = null
      }
      clockRef.current = { offset, rate: playbackRate }
    } else if (offset > clock.offset) {
      clock.offset = offset
    }
  }, [active, playbackTime, playbackRate, cancelScheduled])

  useEffect(() => {
    if (!active) return

    const tempo = safeBpm(bpm)
    const pump = () => {
      const clock = clockRef.current
      if (!clock) return
      const songNow = nowSeconds() * clock.rate + clock.offset
      let next = nextRef.current ?? firstSubdivisionFrom(beatTimes, tempo, songNow)
      while (next !== null) {
        const at = subdivisionTime(beatTimes, tempo, next)
        if (at === null || at >= songNow + LOOKAHEAD_S * clock.rate) break
        if (at >= songNow - STALE_S) schedule(next, (at - songNow) / clock.rate)
        next += 1
      }
      nextRef.current = next
    }
    pump()
    const timer = window.setInterval(pump, SCHEDULER_INTERVAL_MS)

    return () => {
      window.clearInterval(timer)
      cancelScheduled()
      clockRef.current = null
      nextRef.current = null
    }
  }, [active, bpm, beatTimes, schedule, cancelScheduled])
}

/** Drives metronome visual beats, strumming subdivisions, and Web Audio clicks. */
export function useMetronome({
  bpm,
  beatsPerBar,
  emphases,
  enabled,
  soundEnabled,
  volume,
  mode,
  playbackTime = 0,
  playbackPlaying = false,
  playbackRate = 1,
  beatTimes = null,
}: UseMetronomeOptions): UseMetronomeResult {
  const [beat, setBeat] = useState(0)
  const [subdivision, setSubdivision] = useState(0)
  const beatsPerBarRef = useRef(beatsPerBar)
  const emphasesRef = useRef(emphases)
  const soundRef = useRef(soundEnabled)
  const volumeRef = useRef(volume)
  const pendingRef = useRef(new Set<{ timer: number; silence: (() => void) | null }>())

  useEffect(() => { beatsPerBarRef.current = beatsPerBar }, [beatsPerBar])
  useEffect(() => { emphasesRef.current = emphases }, [emphases])
  useEffect(() => { soundRef.current = soundEnabled }, [soundEnabled])
  useEffect(() => { volumeRef.current = volume }, [volume])

  const triggerClick = useCallback(() => {
    resumeMetronomeAudio()
    playMetronomeClick(emphasesRef.current[beat] ?? 'normal', volumeRef.current)
  }, [beat])

  const schedule = useCallback<ScheduleSubdivision>((subdivisionNumber, delaySeconds) => {
    const nextSubdivision = subdivisionNumber % (beatsPerBarRef.current * 2)
    const onBeat = nextSubdivision % 2 === 0
    const silence = onBeat && soundRef.current
      ? playMetronomeClick(emphasesRef.current[nextSubdivision / 2] ?? 'normal', volumeRef.current, delaySeconds)
      : null
    // The beat lights up when its click sounds, not when it was scheduled.
    const entry = { timer: 0, silence }
    entry.timer = window.setTimeout(() => {
      pendingRef.current.delete(entry)
      setSubdivision(nextSubdivision)
      if (onBeat) setBeat(nextSubdivision / 2)
    }, delaySeconds * 1000)
    pendingRef.current.add(entry)
  }, [])

  const cancelScheduled = useCallback(() => {
    for (const entry of pendingRef.current) {
      window.clearTimeout(entry.timer)
      entry.silence?.()
    }
    pendingRef.current.clear()
  }, [])

  const clockOptions = { bpm, enabled, mode, schedule, cancelScheduled }
  useStandaloneClock(clockOptions)
  usePlaybackClock({ ...clockOptions, playbackTime, playbackPlaying, playbackRate, beatTimes })

  return {
    beat: enabled ? beat % beatsPerBar : 0,
    subdivision: enabled ? subdivision % (beatsPerBar * 2) : 0,
    triggerClick,
  }
}

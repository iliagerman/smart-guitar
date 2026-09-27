import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { playMetronomeClick, resumeMetronomeAudio } from '../lib/metronome-audio'
import { gridSubdivisionAt, type GridPosition } from '../lib/song-beat-grid'

export type MetronomeMode = 'standalone' | 'playback'

interface UseMetronomeOptions {
  bpm: number
  beatsPerBar: number
  enabled: boolean
  soundEnabled: boolean
  volume: number
  mode: MetronomeMode
  playbackTime?: number
  playbackPlaying?: boolean
  /** Detected song beats (first is a downbeat); playback clicks follow them instead of a fixed tempo. */
  beatTimes?: readonly number[] | null
}

interface MetronomeClockOptions {
  bpm: number
  enabled: boolean
  mode: MetronomeMode
  lastSubdivisionRef: RefObject<number | null>
  emitSubdivision: (subdivisionNumber: number) => void
}

interface PlaybackClockOptions extends MetronomeClockOptions {
  playbackTime: number
  playbackPlaying: boolean
  beatTimes: readonly number[] | null
}

interface UseMetronomeResult {
  beat: number
  subdivision: number
  triggerClick: () => void
}

const LOOKUP_INTERVAL_MS = 25

function safeBpm(bpm: number): number {
  if (!Number.isFinite(bpm)) return 120
  return Math.max(40, Math.min(240, Math.round(bpm)))
}

function fixedTempoSubdivisionAt(bpm: number, time: number): GridPosition {
  const intervalSeconds = 30 / safeBpm(bpm)
  return { subdivisionNumber: Math.floor(time / intervalSeconds), secondsAfterSubdivision: time % intervalSeconds }
}

function useStandaloneClock({ bpm, enabled, mode, lastSubdivisionRef, emitSubdivision }: MetronomeClockOptions): void {
  const startRef = useRef(0)

  useEffect(() => {
    if (!enabled || mode !== 'standalone') return

    startRef.current = performance.now()
    lastSubdivisionRef.current = null
    const timer = window.setInterval(() => {
      const intervalMs = 30_000 / safeBpm(bpm)
      const subdivisionNumber = Math.floor((performance.now() - startRef.current) / intervalMs)
      if (subdivisionNumber !== lastSubdivisionRef.current) {
        lastSubdivisionRef.current = subdivisionNumber
        emitSubdivision(subdivisionNumber)
      }
    }, LOOKUP_INTERVAL_MS)

    return () => window.clearInterval(timer)
  }, [bpm, enabled, mode, lastSubdivisionRef, emitSubdivision])
}

function usePlaybackClock({
  bpm,
  enabled,
  mode,
  lastSubdivisionRef,
  emitSubdivision,
  playbackTime,
  playbackPlaying,
  beatTimes,
}: PlaybackClockOptions): void {
  useEffect(() => {
    if (!enabled || mode !== 'playback' || !playbackPlaying) return

    const position = beatTimes ? gridSubdivisionAt(beatTimes, playbackTime) : fixedTempoSubdivisionAt(bpm, playbackTime)
    if (!position) return
    const { subdivisionNumber, secondsAfterSubdivision } = position
    if (lastSubdivisionRef.current === null && secondsAfterSubdivision > LOOKUP_INTERVAL_MS / 1000) {
      lastSubdivisionRef.current = subdivisionNumber
      return
    }
    if (subdivisionNumber !== lastSubdivisionRef.current) {
      lastSubdivisionRef.current = subdivisionNumber
      emitSubdivision(subdivisionNumber)
    }
  }, [bpm, beatTimes, enabled, mode, playbackPlaying, playbackTime, lastSubdivisionRef, emitSubdivision])
}

/** Drives metronome visual beats, strumming subdivisions, and Web Audio clicks. */
export function useMetronome({
  bpm,
  beatsPerBar,
  enabled,
  soundEnabled,
  volume,
  mode,
  playbackTime = 0,
  playbackPlaying = false,
  beatTimes = null,
}: UseMetronomeOptions): UseMetronomeResult {
  const [beat, setBeat] = useState(0)
  const [subdivision, setSubdivision] = useState(0)
  const lastSubdivisionRef = useRef<number | null>(null)
  const beatsPerBarRef = useRef(beatsPerBar)
  const soundRef = useRef(soundEnabled)
  const volumeRef = useRef(volume)

  useEffect(() => { beatsPerBarRef.current = beatsPerBar }, [beatsPerBar])
  useEffect(() => { soundRef.current = soundEnabled }, [soundEnabled])
  useEffect(() => { volumeRef.current = volume }, [volume])

  const triggerClick = useCallback(() => {
    resumeMetronomeAudio()
    playMetronomeClick(beat === 0, volumeRef.current)
  }, [beat])

  const emitSubdivision = useCallback((subdivisionNumber: number) => {
    const nextSubdivision = subdivisionNumber % (beatsPerBarRef.current * 2)
    setSubdivision(nextSubdivision)
    if (nextSubdivision % 2 !== 0) return

    const nextBeat = nextSubdivision / 2
    setBeat(nextBeat)
    if (soundRef.current) playMetronomeClick(nextBeat === 0, volumeRef.current)
  }, [])

  const clockOptions = { bpm, enabled, mode, lastSubdivisionRef, emitSubdivision }
  useStandaloneClock(clockOptions)
  usePlaybackClock({ ...clockOptions, playbackTime, playbackPlaying, beatTimes })

  useEffect(() => {
    if (!enabled) lastSubdivisionRef.current = null
  }, [enabled])

  return {
    beat: enabled ? beat % beatsPerBar : 0,
    subdivision: enabled ? subdivision % (beatsPerBar * 2) : 0,
    triggerClick,
  }
}

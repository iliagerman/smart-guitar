import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { playMetronomeClick, resumeMetronomeAudio } from '../lib/metronome-audio'

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
}

interface MetronomeClockOptions {
  bpm: number
  enabled: boolean
  mode: MetronomeMode
  lastBeatRef: RefObject<number | null>
  emitBeat: (beatNumber: number) => void
}

interface PlaybackClockOptions extends MetronomeClockOptions {
  playbackTime: number
  playbackPlaying: boolean
}

interface UseMetronomeResult {
  beat: number
  triggerClick: () => void
}

const LOOKUP_INTERVAL_MS = 25

function safeBpm(bpm: number): number {
  if (!Number.isFinite(bpm)) return 120
  return Math.max(40, Math.min(240, Math.round(bpm)))
}

function useStandaloneClock({ bpm, enabled, mode, lastBeatRef, emitBeat }: MetronomeClockOptions): void {
  const startRef = useRef(0)

  useEffect(() => {
    if (!enabled || mode !== 'standalone') return

    startRef.current = performance.now()
    lastBeatRef.current = null
    const timer = window.setInterval(() => {
      const intervalMs = 60_000 / safeBpm(bpm)
      const beatNumber = Math.floor((performance.now() - startRef.current) / intervalMs)
      if (beatNumber !== lastBeatRef.current) {
        lastBeatRef.current = beatNumber
        emitBeat(beatNumber)
      }
    }, LOOKUP_INTERVAL_MS)

    return () => window.clearInterval(timer)
  }, [bpm, enabled, mode, lastBeatRef, emitBeat])
}

function usePlaybackClock({
  bpm,
  enabled,
  mode,
  lastBeatRef,
  emitBeat,
  playbackTime,
  playbackPlaying,
}: PlaybackClockOptions): void {
  useEffect(() => {
    if (!enabled || mode !== 'playback' || !playbackPlaying) return

    const intervalSeconds = 60 / safeBpm(bpm)
    const beatNumber = Math.floor(playbackTime / intervalSeconds)
    const secondsAfterBeat = playbackTime % intervalSeconds
    if (lastBeatRef.current === null && secondsAfterBeat > LOOKUP_INTERVAL_MS / 1000) {
      lastBeatRef.current = beatNumber
      return
    }
    if (beatNumber !== lastBeatRef.current) {
      lastBeatRef.current = beatNumber
      emitBeat(beatNumber)
    }
  }, [bpm, enabled, mode, playbackPlaying, playbackTime, lastBeatRef, emitBeat])
}

/** Drives metronome visual beats and Web Audio clicks. */
export function useMetronome({
  bpm,
  beatsPerBar,
  enabled,
  soundEnabled,
  volume,
  mode,
  playbackTime = 0,
  playbackPlaying = false,
}: UseMetronomeOptions): UseMetronomeResult {
  const [beat, setBeat] = useState(0)
  const lastBeatRef = useRef<number | null>(null)
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

  const emitBeat = useCallback((beatNumber: number) => {
    const nextBeat = beatNumber % beatsPerBarRef.current
    setBeat(nextBeat)
    if (soundRef.current) playMetronomeClick(nextBeat === 0, volumeRef.current)
  }, [])

  const clockOptions = { bpm, enabled, mode, lastBeatRef, emitBeat }
  useStandaloneClock(clockOptions)
  usePlaybackClock({ ...clockOptions, playbackTime, playbackPlaying })

  useEffect(() => {
    if (!enabled) lastBeatRef.current = null
  }, [enabled])

  return { beat: enabled ? beat % beatsPerBar : 0, triggerClick }
}

import { useCallback, useEffect, useRef, useState } from 'react'

export type MetronomeMode = 'standalone' | 'playback'

interface UseMetronomeOptions {
  bpm: number
  enabled: boolean
  soundEnabled: boolean
  mode: MetronomeMode
  playbackTime?: number
  playbackPlaying?: boolean
}

interface UseMetronomeResult {
  beat: number
  triggerClick: () => void
}

const BEATS_PER_BAR = 4
const LOOKUP_INTERVAL_MS = 25

function safeBpm(bpm: number): number {
  if (!Number.isFinite(bpm)) return 120
  return Math.max(40, Math.min(240, Math.round(bpm)))
}

function playClick(context: AudioContext, accented: boolean): void {
  const now = context.currentTime
  const oscillator = context.createOscillator()
  const gain = context.createGain()

  oscillator.frequency.value = accented ? 1320 : 880
  gain.gain.setValueAtTime(0.0001, now)
  gain.gain.exponentialRampToValueAtTime(accented ? 0.45 : 0.25, now + 0.004)
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.055)

  oscillator.connect(gain)
  gain.connect(context.destination)
  oscillator.start(now)
  oscillator.stop(now + 0.06)
}

/**
 * Drives metronome visual beats and optional Web Audio clicks.
 */
export function useMetronome({
  bpm,
  enabled,
  soundEnabled,
  mode,
  playbackTime = 0,
  playbackPlaying = false,
}: UseMetronomeOptions): UseMetronomeResult {
  const [beat, setBeat] = useState(0)
  const audioContextRef = useRef<AudioContext | null>(null)
  const lastBeatRef = useRef<number | null>(null)
  const standaloneStartRef = useRef<number>(0)
  const bpmRef = useRef(safeBpm(bpm))
  const soundRef = useRef(soundEnabled)

  useEffect(() => {
    bpmRef.current = safeBpm(bpm)
  }, [bpm])

  useEffect(() => {
    soundRef.current = soundEnabled
  }, [soundEnabled])

  const triggerClick = useCallback(() => {
    if (!audioContextRef.current) {
      audioContextRef.current = new AudioContext()
    }
    if (audioContextRef.current.state === 'suspended') {
      void audioContextRef.current.resume()
    }
    playClick(audioContextRef.current, beat === 0)
  }, [beat])

  const emitBeat = useCallback((beatNumber: number) => {
    const nextBeat = beatNumber % BEATS_PER_BAR
    setBeat(nextBeat)
    if (soundRef.current) {
      if (!audioContextRef.current) audioContextRef.current = new AudioContext()
      playClick(audioContextRef.current, nextBeat === 0)
    }
  }, [])

  useEffect(() => {
    if (!enabled || mode !== 'standalone') return

    standaloneStartRef.current = performance.now()
    lastBeatRef.current = null

    const timer = window.setInterval(() => {
      const intervalMs = 60_000 / bpmRef.current
      const beatNumber = Math.floor((performance.now() - standaloneStartRef.current) / intervalMs)
      if (beatNumber !== lastBeatRef.current) {
        lastBeatRef.current = beatNumber
        emitBeat(beatNumber)
      }
    }, LOOKUP_INTERVAL_MS)

    return () => window.clearInterval(timer)
  }, [enabled, mode, emitBeat])

  useEffect(() => {
    if (!enabled || mode !== 'playback' || !playbackPlaying) return

    const intervalSeconds = 60 / bpmRef.current
    const beatNumber = Math.floor(playbackTime / intervalSeconds)
    if (beatNumber !== lastBeatRef.current) {
      lastBeatRef.current = beatNumber
      emitBeat(beatNumber)
    }
  }, [enabled, mode, playbackPlaying, playbackTime, emitBeat])

  useEffect(() => {
    if (enabled) return
    lastBeatRef.current = null
  }, [enabled])

  useEffect(() => {
    return () => {
      if (audioContextRef.current) {
        void audioContextRef.current.close()
      }
    }
  }, [])

  return { beat: enabled ? beat : 0, triggerClick }
}

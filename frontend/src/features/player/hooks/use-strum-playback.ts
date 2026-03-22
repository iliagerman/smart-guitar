import { useState, useRef, useCallback, useEffect } from 'react'

/**
 * Determine the note subdivision based on pattern length.
 * Returns the interval in seconds between each strum.
 */
function strumInterval(patternLength: number, bpm: number): number {
  const beatDuration = 60 / bpm
  if (patternLength <= 4) return beatDuration          // quarter notes
  if (patternLength <= 8) return beatDuration / 2      // eighth notes
  return beatDuration / 4                               // sixteenth notes
}

/**
 * Create a buffer of white noise for strum sounds.
 */
let noiseBuffer: AudioBuffer | null = null
function getNoiseBuffer(ctx: AudioContext): AudioBuffer {
  if (noiseBuffer && noiseBuffer.sampleRate === ctx.sampleRate) return noiseBuffer
  const length = ctx.sampleRate * 0.15
  noiseBuffer = ctx.createBuffer(1, length, ctx.sampleRate)
  const data = noiseBuffer.getChannelData(0)
  for (let i = 0; i < length; i++) {
    data[i] = Math.random() * 2 - 1
  }
  return noiseBuffer
}

/**
 * Play a strum-like sound using filtered noise + a short chord tone.
 * Down strums are fuller and louder, up strums are lighter and brighter.
 */
function playStrum(ctx: AudioContext, time: number, direction: 'down' | 'up') {
  const isDown = direction === 'down'

  // Layer 1: Filtered noise for the "scrape" character
  const noise = ctx.createBufferSource()
  noise.buffer = getNoiseBuffer(ctx)
  const noiseFilter = ctx.createBiquadFilter()
  noiseFilter.type = 'bandpass'
  noiseFilter.frequency.value = isDown ? 1500 : 2500
  noiseFilter.Q.value = 1.5
  const noiseGain = ctx.createGain()
  noise.connect(noiseFilter)
  noiseFilter.connect(noiseGain)
  noiseGain.connect(ctx.destination)

  const noiseDuration = isDown ? 0.08 : 0.05
  noiseGain.gain.setValueAtTime(isDown ? 0.15 : 0.08, time)
  noiseGain.gain.exponentialRampToValueAtTime(0.001, time + noiseDuration)
  noise.start(time)
  noise.stop(time + noiseDuration)

  // Layer 2: Short chord-like tone for body
  const osc = ctx.createOscillator()
  const oscGain = ctx.createGain()
  osc.connect(oscGain)
  oscGain.connect(ctx.destination)
  osc.type = 'triangle'
  // Down: open chord ~82Hz (low E). Up: higher partial ~165Hz
  osc.frequency.value = isDown ? 82 : 165
  const oscDuration = isDown ? 0.12 : 0.08
  oscGain.gain.setValueAtTime(isDown ? 0.12 : 0.06, time)
  oscGain.gain.exponentialRampToValueAtTime(0.001, time + oscDuration)
  osc.start(time)
  osc.stop(time + oscDuration)
}

/**
 * Hook that plays a strumming pattern using Web Audio API.
 * Returns playback state, current beat index (for highlighting), and toggle function.
 */
export function useStrumPlayback(pattern: ('down' | 'up')[], bpm: number) {
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentBeatIndex, setCurrentBeatIndex] = useState(-1)
  const ctxRef = useRef<AudioContext | null>(null)
  const rafRef = useRef<number>(0)
  const startTimeRef = useRef(0)
  const patternRef = useRef(pattern)
  const bpmRef = useRef(bpm)

  // Keep refs in sync
  patternRef.current = pattern
  bpmRef.current = bpm

  const stop = useCallback(() => {
    setIsPlaying(false)
    setCurrentBeatIndex(-1)
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
  }, [])

  const play = useCallback(() => {
    if (pattern.length === 0) return

    // Create or resume AudioContext
    if (!ctxRef.current || ctxRef.current.state === 'closed') {
      ctxRef.current = new AudioContext()
    }
    const ctx = ctxRef.current
    if (ctx.state === 'suspended') ctx.resume()

    const interval = strumInterval(pattern.length, bpm)
    const now = ctx.currentTime + 0.05 // slight lookahead
    startTimeRef.current = now

    // Schedule 2 loops of the pattern
    const totalBeats = pattern.length * 2
    for (let i = 0; i < totalBeats; i++) {
      const beatTime = now + i * interval
      const dir = pattern[i % pattern.length]
      playStrum(ctx, beatTime, dir)
    }

    setIsPlaying(true)

    // Track current beat for visual highlighting
    const totalDuration = totalBeats * interval
    const tick = () => {
      const elapsed = ctx.currentTime - startTimeRef.current
      if (elapsed >= totalDuration) {
        stop()
        return
      }
      const beatIndex = Math.floor(elapsed / interval) % patternRef.current.length
      setCurrentBeatIndex(beatIndex)
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
  }, [pattern, bpm, stop])

  const toggle = useCallback(() => {
    if (isPlaying) {
      stop()
    } else {
      play()
    }
  }, [isPlaying, play, stop])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      ctxRef.current?.close()
    }
  }, [])

  // Stop if pattern or bpm changes
  useEffect(() => {
    if (isPlaying) stop()
  }, [pattern, bpm]) // eslint-disable-line react-hooks/exhaustive-deps

  return { isPlaying, currentBeatIndex, toggle }
}

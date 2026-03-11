import { useState, useRef, useCallback, useEffect } from 'react'
import { PitchDetector } from 'pitchy'
import {
  type GuitarString,
  type DetectedNote,
  findNearestNote,
  findNearestString,
  centsFromTarget,
} from '../lib/tuning'

const CLARITY_THRESHOLD = 0.8
const FFT_SIZE = 8192
const HOLD_MS = 600 // keep last note visible for this long after signal drops
const SMOOTHING_WINDOW_SIZE = 5
const MIN_DETECTABLE_FREQUENCY = 70
const MAX_DETECTABLE_FREQUENCY = 400

function roundToTenth(value: number) {
  return Math.round(value * 10) / 10
}

function median(values: number[]) {
  if (values.length === 0) return 0

  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)

  if (sorted.length % 2 === 0) {
    return (sorted[middle - 1] + sorted[middle]) / 2
  }

  return sorted[middle]
}

function normalizePitchForGuitar(pitch: number, targetFrequency?: number | null) {
  const candidates = [pitch / 4, pitch / 2, pitch, pitch * 2, pitch * 4].filter(
    (candidate) => candidate >= MIN_DETECTABLE_FREQUENCY && candidate <= MAX_DETECTABLE_FREQUENCY
  )

  return candidates.reduce((best, candidate) => {
    const bestTarget = targetFrequency ?? findNearestString(best).frequency
    const candidateTarget = targetFrequency ?? findNearestString(candidate).frequency
    const bestDistance = Math.abs(centsFromTarget(best, bestTarget))
    const candidateDistance = Math.abs(centsFromTarget(candidate, candidateTarget))
    return candidateDistance < bestDistance ? candidate : best
  }, pitch)
}

function smoothPitch(history: number[], nextPitch: number) {
  history.push(nextPitch)
  if (history.length > SMOOTHING_WINDOW_SIZE) {
    history.shift()
  }

  return median(history)
}

export interface TunerState {
  isListening: boolean
  permissionDenied: boolean
  detectedNote: DetectedNote | null
  detectedFrequency: number | null
  cents: number
  clarity: number
  nearestString: GuitarString | null
  selectedString: GuitarString | null
  start: () => Promise<void>
  stop: () => void
  selectString: (s: GuitarString | null) => void
}

export function useTuner(): TunerState {
  const [isListening, setIsListening] = useState(false)
  const [permissionDenied, setPermissionDenied] = useState(false)
  const [detectedNote, setDetectedNote] = useState<DetectedNote | null>(null)
  const [detectedFrequency, setDetectedFrequency] = useState<number | null>(null)
  const [cents, setCents] = useState(0)
  const [clarity, setClarity] = useState(0)
  const [nearestString, setNearestString] = useState<GuitarString | null>(null)
  const [selectedString, setSelectedString] = useState<GuitarString | null>(null)

  const audioContextRef = useRef<AudioContext | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const pitchHistoryRef = useRef<number[]>([])
  const selectedStringRef = useRef<GuitarString | null>(null)
  const rafRef = useRef<number>(0)
  const isRunningRef = useRef(false)

  const stopInternal = useCallback(() => {
    isRunningRef.current = false
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = 0
    }
    if (sourceRef.current) {
      sourceRef.current.disconnect()
      sourceRef.current = null
    }
    if (analyserRef.current) {
      analyserRef.current = null
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
    if (audioContextRef.current) {
      audioContextRef.current.close()
      audioContextRef.current = null
    }
    pitchHistoryRef.current = []
    setIsListening(false)
    setDetectedNote(null)
    setDetectedFrequency(null)
    setNearestString(null)
    setCents(0)
    setClarity(0)
  }, [])

  const start = useCallback(async () => {
    // Prevent double-start
    if (isRunningRef.current) return

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      })

      const audioContext = new AudioContext()

      // iOS Safari requires explicit resume from user gesture
      if (audioContext.state === 'suspended') {
        await audioContext.resume()
      }

      const source = audioContext.createMediaStreamSource(stream)
      const highpass = audioContext.createBiquadFilter()
      highpass.type = 'highpass'
      highpass.frequency.value = 60
      highpass.Q.value = 0.7

      const lowpass = audioContext.createBiquadFilter()
      lowpass.type = 'lowpass'
      lowpass.frequency.value = 1200
      lowpass.Q.value = 0.7

      const analyser = audioContext.createAnalyser()
      analyser.fftSize = FFT_SIZE
      analyser.smoothingTimeConstant = 0

      source.connect(highpass)
      highpass.connect(lowpass)
      lowpass.connect(analyser)

      // Store refs
      streamRef.current = stream
      audioContextRef.current = audioContext
      sourceRef.current = source
      analyserRef.current = analyser
      isRunningRef.current = true

      setIsListening(true)
      setPermissionDenied(false)
      pitchHistoryRef.current = []

      // Start detection loop — all resources captured directly, not via refs
      const buffer = new Float32Array(analyser.fftSize)
      const detector = PitchDetector.forFloat32Array(analyser.fftSize)
      detector.minVolumeDecibels = -30

      let lastGoodTime = 0

      const loop = () => {
        if (!isRunningRef.current) return

        analyser.getFloatTimeDomainData(buffer)
        const [pitch, clar] = detector.findPitch(buffer, audioContext.sampleRate)

        setClarity(clar)

        const now = performance.now()

        if (
          clar >= CLARITY_THRESHOLD &&
          pitch >= MIN_DETECTABLE_FREQUENCY &&
          pitch <= MAX_DETECTABLE_FREQUENCY * 4
        ) {
          lastGoodTime = now
          const selectedTarget = selectedStringRef.current?.frequency ?? null
          const normalizedPitch = normalizePitchForGuitar(pitch, selectedTarget)
          const stablePitch = smoothPitch(pitchHistoryRef.current, normalizedPitch)
          const note = findNearestNote(stablePitch)
          const nearest = findNearestString(stablePitch)

          setDetectedNote(note)
          setDetectedFrequency(roundToTenth(stablePitch))
          setNearestString(nearest)
          setCents(note.cents)
        } else if (now - lastGoodTime > HOLD_MS) {
          // Only clear after hold period — prevents flickering
          pitchHistoryRef.current = []
          setDetectedNote(null)
          setDetectedFrequency(null)
          setNearestString(null)
          setCents(0)
        }

        rafRef.current = requestAnimationFrame(loop)
      }

      rafRef.current = requestAnimationFrame(loop)
    } catch (err) {
      if (err instanceof DOMException && err.name === 'NotAllowedError') {
        setPermissionDenied(true)
      }
      stopInternal()
    }
  }, [stopInternal])

  const selectString = useCallback((s: GuitarString | null) => {
    setSelectedString(s)
  }, [])

  useEffect(() => {
    selectedStringRef.current = selectedString
  }, [selectedString])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      isRunningRef.current = false
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      if (sourceRef.current) sourceRef.current.disconnect()
      if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop())
      if (audioContextRef.current) audioContextRef.current.close()
    }
  }, [])

  // Recompute cents when selectedString changes (manual mode)
  const effectiveCents =
    selectedString && detectedFrequency
      ? centsFromTarget(detectedFrequency, selectedString.frequency)
      : cents

  return {
    isListening,
    permissionDenied,
    detectedNote,
    detectedFrequency,
    cents: effectiveCents,
    clarity,
    nearestString,
    selectedString,
    start,
    stop: stopInternal,
    selectString,
  }
}

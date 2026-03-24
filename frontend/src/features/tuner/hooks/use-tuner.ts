import { useState, useRef, useCallback, useEffect, useMemo } from 'react'
import { PitchDetector } from 'pitchy'
import {
  type GuitarString,
  type DetectedNote,
  STANDARD_TUNING,
  findNearestNote,
  findNearestString,
  centsFromTarget,
  shiftTuning,
} from '../lib/tuning'

const CLARITY_THRESHOLD = 0.85
const FFT_SIZE = 8192
const HOLD_MS = 600 // keep last note visible for this long after signal drops
const SMOOTHING_WINDOW_SIZE = 9
const MIN_DETECTABLE_FREQUENCY = 70
const MAX_DETECTABLE_FREQUENCY = 400
const MIN_RMS_THRESHOLD = 0.008 // ignore signal below this RMS level
const OUTLIER_CENTS_THRESHOLD = 80 // reject readings that jump more than this from the median
const MIN_CONSECUTIVE_GOOD = 2 // require N consecutive good reads before updating display

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

function computeRms(buffer: Float32Array): number {
  let sum = 0
  for (let i = 0; i < buffer.length; i++) {
    sum += buffer[i] * buffer[i]
  }
  return Math.sqrt(sum / buffer.length)
}

function smoothPitch(history: number[], nextPitch: number) {
  // Reject outlier: if we have history, check the new reading isn't wildly different
  if (history.length >= 3) {
    const currentMedian = median(history)
    const deviation = Math.abs(1200 * Math.log2(nextPitch / currentMedian))
    if (deviation > OUTLIER_CENTS_THRESHOLD) {
      // Don't add this reading — it's likely noise
      return currentMedian
    }
  }

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
  semitoneOffset: number
  activeTuning: GuitarString[]
  start: () => Promise<void>
  stop: () => void
  selectString: (s: GuitarString | null) => void
  setSemitoneOffset: (offset: number) => void
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
  const [semitoneOffset, setSemitoneOffset] = useState(0)

  const activeTuning = useMemo(
    () => shiftTuning(STANDARD_TUNING, semitoneOffset),
    [semitoneOffset]
  )

  const audioContextRef = useRef<AudioContext | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const pitchHistoryRef = useRef<number[]>([])
  const selectedStringRef = useRef<GuitarString | null>(null)
  const activeTuningRef = useRef<GuitarString[]>(activeTuning)
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
      highpass.frequency.value = 75
      highpass.Q.value = 1.0

      const lowpass = audioContext.createBiquadFilter()
      lowpass.type = 'lowpass'
      lowpass.frequency.value = 900
      lowpass.Q.value = 1.0

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
      detector.minVolumeDecibels = -25

      let lastGoodTime = 0
      let consecutiveGood = 0
      let pendingNote: DetectedNote | null = null
      let pendingFrequency = 0
      let pendingNearest: GuitarString | null = null

      const loop = () => {
        if (!isRunningRef.current) return

        analyser.getFloatTimeDomainData(buffer)

        // Volume gate: ignore signal below minimum RMS threshold
        const rms = computeRms(buffer)
        if (rms < MIN_RMS_THRESHOLD) {
          const now = performance.now()
          if (now - lastGoodTime > HOLD_MS) {
            pitchHistoryRef.current = []
            consecutiveGood = 0
            setDetectedNote(null)
            setDetectedFrequency(null)
            setNearestString(null)
            setCents(0)
          }
          setClarity(0)
          rafRef.current = requestAnimationFrame(loop)
          return
        }

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
          const nearest = findNearestString(stablePitch, activeTuningRef.current)

          pendingNote = note
          pendingFrequency = roundToTenth(stablePitch)
          pendingNearest = nearest
          consecutiveGood++

          // Only update display after N consecutive good readings
          if (consecutiveGood >= MIN_CONSECUTIVE_GOOD) {
            setDetectedNote(pendingNote)
            setDetectedFrequency(pendingFrequency)
            setNearestString(pendingNearest)
            setCents(note.cents)
          }
        } else {
          consecutiveGood = 0
          if (now - lastGoodTime > HOLD_MS) {
            pitchHistoryRef.current = []
            setDetectedNote(null)
            setDetectedFrequency(null)
            setNearestString(null)
            setCents(0)
          }
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

  useEffect(() => {
    activeTuningRef.current = activeTuning
    // Update selected string to match new tuning frequencies
    if (selectedString) {
      const updated = activeTuning.find((s) => s.stringNumber === selectedString.stringNumber)
      if (updated) setSelectedString(updated)
    }
  }, [activeTuning]) // eslint-disable-line react-hooks/exhaustive-deps

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
    semitoneOffset,
    activeTuning,
    start,
    stop: stopInternal,
    selectString,
    setSemitoneOffset,
  }
}

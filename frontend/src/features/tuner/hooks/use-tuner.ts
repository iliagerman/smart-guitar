import { useRef, useCallback, useEffect, useMemo } from 'react'
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
import { useTunerState } from './use-tuner-state'

const CLARITY_THRESHOLD = 0.85
const FFT_SIZE = 8192
const HOLD_MS = 600
const SMOOTHING_WINDOW_SIZE = 9
const MIN_DETECTABLE_FREQUENCY = 70
const MAX_DETECTABLE_FREQUENCY = 400
const MIN_RMS_THRESHOLD = 0.008
const OUTLIER_CENTS_THRESHOLD = 80
const MIN_CONSECUTIVE_GOOD = 2

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
  if (history.length >= 3) {
    const currentMedian = median(history)
    const deviation = Math.abs(1200 * Math.log2(nextPitch / currentMedian))
    if (deviation > OUTLIER_CENTS_THRESHOLD) {
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
  const [state, actions] = useTunerState()

  const activeTuning = useMemo(
    () => shiftTuning(STANDARD_TUNING, state.semitoneOffset),
    [state.semitoneOffset]
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
    actions.stopListening()
  }, [actions])

  const start = useCallback(async () => {
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

      streamRef.current = stream
      audioContextRef.current = audioContext
      sourceRef.current = source
      analyserRef.current = analyser
      isRunningRef.current = true

      actions.startListening()
      pitchHistoryRef.current = []

      const buffer = new Float32Array(analyser.fftSize)
      const detector = PitchDetector.forFloat32Array(analyser.fftSize)
      detector.minVolumeDecibels = -25

      let lastGoodTime = 0
      let consecutiveGood = 0

      const loop = () => {
        if (!isRunningRef.current) return

        analyser.getFloatTimeDomainData(buffer)

        const rms = computeRms(buffer)
        if (rms < MIN_RMS_THRESHOLD) {
          const now = performance.now()
          if (now - lastGoodTime > HOLD_MS) {
            pitchHistoryRef.current = []
            consecutiveGood = 0
            actions.clearDetection()
          }
          actions.setClarity(0)
          rafRef.current = requestAnimationFrame(loop)
          return
        }

        const [pitch, clar] = detector.findPitch(buffer, audioContext.sampleRate)

        actions.setClarity(clar)

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

          consecutiveGood++

          if (consecutiveGood >= MIN_CONSECUTIVE_GOOD) {
            actions.updateDetection(note, roundToTenth(stablePitch), nearest, note.cents)
          }
        } else {
          consecutiveGood = 0
          if (now - lastGoodTime > HOLD_MS) {
            pitchHistoryRef.current = []
            actions.clearDetection()
          }
        }

        rafRef.current = requestAnimationFrame(loop)
      }

      rafRef.current = requestAnimationFrame(loop)
    } catch (err) {
      if (err instanceof DOMException && err.name === 'NotAllowedError') {
        actions.permissionDenied()
      }
      stopInternal()
    }
  }, [stopInternal, actions])

  useEffect(() => {
    selectedStringRef.current = state.selectedString
  }, [state.selectedString])

  useEffect(() => {
    activeTuningRef.current = activeTuning
    if (state.selectedString) {
      const updated = activeTuning.find((s) => s.stringNumber === state.selectedString!.stringNumber)
      if (updated) actions.selectString(updated)
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
    state.selectedString && state.detectedFrequency
      ? centsFromTarget(state.detectedFrequency, state.selectedString.frequency)
      : state.cents

  return {
    isListening: state.isListening,
    permissionDenied: state.permissionDenied,
    detectedNote: state.detectedNote,
    detectedFrequency: state.detectedFrequency,
    cents: effectiveCents,
    clarity: state.clarity,
    nearestString: state.nearestString,
    selectedString: state.selectedString,
    semitoneOffset: state.semitoneOffset,
    activeTuning,
    start,
    stop: stopInternal,
    selectString: actions.selectString,
    setSemitoneOffset: actions.setSemitoneOffset,
  }
}

import { useState, useRef, useCallback, useEffect } from 'react'
import { Mp3Encoder } from '@breezystack/lamejs'
import { downloadBlob } from '../lib/download-blob'

/** Pre-resolved backing track tap from the stem mixer. */
interface BackingTrackTap {
  context: AudioContext
  node: AudioNode
}

interface RecorderOptions {
  /** When set, the recorder uses the shared AudioContext and mixes the
   *  backing track digitally into the output. Requires headphones. */
  backingTrackTap?: BackingTrackTap | null
  /** Gain for the guitar (mic) input. Default 3.0. */
  guitarGain?: number
  /** Gain for the backing track in the mix. Default 0.5. Only used when
   *  backingTrackTap is provided. */
  backingGain?: number
}

interface RecorderState {
  isRecording: boolean
  recordingDuration: number
  permissionDenied: boolean
  recordedBlob: Blob | null
  startRecording: (filename: string) => Promise<void>
  stopRecording: (autoDownload?: boolean) => void
  downloadRecording: () => void
  clearRecording: () => void
}

const DEFAULT_GUITAR_GAIN = 3.0
const MP3_KBPS = 128
const SAMPLES_PER_FRAME = 1152

function floatTo16Bit(float32: Float32Array): Int16Array {
  const int16 = new Int16Array(float32.length)
  for (let i = 0; i < float32.length; i++) {
    const clamped = Math.max(-1, Math.min(1, float32[i]))
    int16[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff
  }
  return int16
}

// Inline AudioWorklet processor code — captures raw PCM samples
const WORKLET_CODE = `
class RecorderProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0];
    if (input.length > 0) {
      this.port.postMessage(new Float32Array(input[0]));
    }
    return true;
  }
}
registerProcessor('recorder-processor', RecorderProcessor);
`

const registeredContexts = new WeakSet<AudioContext>()

async function ensureWorklet(audioCtx: AudioContext) {
  if (registeredContexts.has(audioCtx)) return
  const blob = new Blob([WORKLET_CODE], { type: 'application/javascript' })
  const url = URL.createObjectURL(blob)
  await audioCtx.audioWorklet.addModule(url)
  URL.revokeObjectURL(url)
  registeredContexts.add(audioCtx)
}

export function useRecorder(options: RecorderOptions = {}): RecorderState {
  const { backingTrackTap = null, guitarGain = DEFAULT_GUITAR_GAIN, backingGain = 0.5 } = options
  const isDigitalMix = backingTrackTap !== null && backingTrackTap !== undefined
  const [isRecording, setIsRecording] = useState(false)
  const [recordingDuration, setRecordingDuration] = useState(0)
  const [permissionDenied, setPermissionDenied] = useState(false)
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null)

  const streamRef = useRef<MediaStream | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const ownsAudioContextRef = useRef(false)
  const workletNodeRef = useRef<AudioWorkletNode | null>(null)
  const backingGainNodeRef = useRef<GainNode | null>(null)
  const pcmChunksRef = useRef<Float32Array[]>([])
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const filenameRef = useRef('')

  const cleanup = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
    if (workletNodeRef.current) {
      workletNodeRef.current.disconnect()
      workletNodeRef.current = null
    }
    if (backingGainNodeRef.current) {
      backingGainNodeRef.current.disconnect()
      backingGainNodeRef.current = null
    }
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) {
        track.stop()
      }
      streamRef.current = null
    }
    // Only close the AudioContext if we created it (mic-only mode).
    // In digital-mix mode the context belongs to the stem mixer.
    if (audioContextRef.current && ownsAudioContextRef.current) {
      audioContextRef.current.close()
    }
    audioContextRef.current = null
    ownsAudioContextRef.current = false
  }, [])

  useEffect(() => cleanup, [cleanup])

  // Proactively detect denied microphone permission
  useEffect(() => {
    navigator.permissions?.query({ name: 'microphone' as PermissionName })
      .then((status) => {
        if (status.state === 'denied') setPermissionDenied(true)
        status.onchange = () => {
          setPermissionDenied(status.state === 'denied')
        }
      })
      .catch(() => { /* permissions API not supported */ })
  }, [])

  const startRecording = useCallback(async (filename: string) => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      })

      streamRef.current = stream
      pcmChunksRef.current = []
      filenameRef.current = filename
      setPermissionDenied(false)
      setRecordedBlob(null)

      // In digital-mix mode reuse the stem mixer's AudioContext so we can
      // tap its output. In mic-only mode create a dedicated context.
      let audioCtx: AudioContext
      if (isDigitalMix && backingTrackTap) {
        audioCtx = backingTrackTap.context
        ownsAudioContextRef.current = false
      } else {
        audioCtx = new AudioContext()
        ownsAudioContextRef.current = true
      }
      await audioCtx.resume()
      audioContextRef.current = audioCtx

      await ensureWorklet(audioCtx)

      const source = audioCtx.createMediaStreamSource(stream)
      const micGainNode = audioCtx.createGain()
      micGainNode.gain.value = guitarGain

      const workletNode = new AudioWorkletNode(audioCtx, 'recorder-processor')
      workletNodeRef.current = workletNode

      workletNode.port.onmessage = (e: MessageEvent<Float32Array>) => {
        pcmChunksRef.current.push(e.data)
      }

      // Sum mic and (optionally) backing track into the worklet.
      // A merger GainNode sums both signals before the worklet captures them.
      const sumNode = audioCtx.createGain()
      sumNode.gain.value = 1
      sumNode.connect(workletNode)

      source.connect(micGainNode)
      micGainNode.connect(sumNode)

      if (isDigitalMix && backingTrackTap) {
        const bGain = audioCtx.createGain()
        bGain.gain.value = backingGain
        backingTrackTap.node.connect(bGain)
        bGain.connect(sumNode)
        backingGainNodeRef.current = bGain
      }

      setIsRecording(true)
      setRecordingDuration(0)

      const startTime = Date.now()
      timerRef.current = setInterval(() => {
        setRecordingDuration(Math.floor((Date.now() - startTime) / 1000))
      }, 500)
    } catch (err) {
      cleanup()
      if (err instanceof DOMException && err.name === 'NotAllowedError') {
        setPermissionDenied(true)
      }
      throw err
    }
  }, [cleanup, isDigitalMix, backingTrackTap, guitarGain, backingGain])

  const stopRecording = useCallback((autoDownload = true) => {
    const sampleRate = audioContextRef.current?.sampleRate ?? 44100
    const chunks = [...pcmChunksRef.current]
    const filename = filenameRef.current

    setIsRecording(false)
    cleanup()
    pcmChunksRef.current = []

    if (chunks.length === 0) return

    // Merge PCM chunks
    const totalLength = chunks.reduce((sum, c) => sum + c.length, 0)
    const pcm = new Float32Array(totalLength)
    let offset = 0
    for (const chunk of chunks) {
      pcm.set(chunk, offset)
      offset += chunk.length
    }

    const int16 = floatTo16Bit(pcm)

    // Encode to MP3
    const encoder = new Mp3Encoder(1, sampleRate, MP3_KBPS)
    const mp3Chunks: Uint8Array[] = []

    for (let i = 0; i < int16.length; i += SAMPLES_PER_FRAME) {
      const frame = int16.subarray(i, i + SAMPLES_PER_FRAME)
      const encoded = encoder.encodeBuffer(frame)
      if (encoded.length > 0) {
        mp3Chunks.push(new Uint8Array(encoded))
      }
    }

    const flushed = encoder.flush()
    if (flushed.length > 0) {
      mp3Chunks.push(new Uint8Array(flushed))
    }

    const blob = new Blob(mp3Chunks as BlobPart[], { type: 'audio/mpeg' })
    setRecordedBlob(blob)

    if (autoDownload) {
      setTimeout(() => downloadBlob(blob, `${filename}.mp3`), 0)
    }
  }, [cleanup])

  const downloadRecording = useCallback(() => {
    if (!recordedBlob) return
    downloadBlob(recordedBlob, `${filenameRef.current}.mp3`)
    setRecordedBlob(null)
  }, [recordedBlob])

  const clearRecording = useCallback(() => {
    setRecordedBlob(null)
  }, [])

  return {
    isRecording,
    recordingDuration,
    permissionDenied,
    recordedBlob,
    startRecording,
    stopRecording,
    downloadRecording,
    clearRecording,
  }
}

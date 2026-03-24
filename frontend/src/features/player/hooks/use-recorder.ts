import { useState, useRef, useCallback, useEffect } from 'react'
import { Mp3Encoder } from '@breezystack/lamejs'

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

const GAIN_VALUE = 3.0
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

function downloadBlob(blob: Blob, filename: string) {
  if (blob.size === 0) return
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  setTimeout(() => {
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }, 1000)
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

export function useRecorder(): RecorderState {
  const [isRecording, setIsRecording] = useState(false)
  const [recordingDuration, setRecordingDuration] = useState(0)
  const [permissionDenied, setPermissionDenied] = useState(false)
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null)

  const streamRef = useRef<MediaStream | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const workletNodeRef = useRef<AudioWorkletNode | null>(null)
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
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) {
        track.stop()
      }
      streamRef.current = null
    }
    if (audioContextRef.current) {
      audioContextRef.current.close()
      audioContextRef.current = null
    }
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

      const audioCtx = new AudioContext()
      await audioCtx.resume()
      audioContextRef.current = audioCtx

      await ensureWorklet(audioCtx)

      const source = audioCtx.createMediaStreamSource(stream)
      const gainNode = audioCtx.createGain()
      gainNode.gain.value = GAIN_VALUE

      const workletNode = new AudioWorkletNode(audioCtx, 'recorder-processor')
      workletNodeRef.current = workletNode

      workletNode.port.onmessage = (e: MessageEvent<Float32Array>) => {
        pcmChunksRef.current.push(e.data)
      }

      source.connect(gainNode)
      gainNode.connect(workletNode)

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
  }, [cleanup])

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
        mp3Chunks.push(encoded)
      }
    }

    const flushed = encoder.flush()
    if (flushed.length > 0) {
      mp3Chunks.push(flushed)
    }

    const blob = new Blob(mp3Chunks, { type: 'audio/mpeg' })
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

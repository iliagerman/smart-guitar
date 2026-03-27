import { useState, useRef, useCallback, useEffect } from 'react'
import { FFmpeg } from '@ffmpeg/ffmpeg'
import { toBlobURL, fetchFile } from '@ffmpeg/util'
import { downloadBlob } from '../lib/download-blob'

interface VideoRecorderState {
  isRecording: boolean
  recordingDuration: number
  permissionDenied: boolean
  recordedBlob: Blob | null
  videoPreviewStream: MediaStream | null
  startRecording: (filename: string) => Promise<void>
  stopRecording: (autoDownload?: boolean) => void
  downloadRecording: () => void
  clearRecording: () => void
}

function pickMimeType(): string {
  const candidates = [
    'video/mp4;codecs=avc1,mp4a.40.2',
    'video/mp4',
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
  ]
  for (const mime of candidates) {
    if (MediaRecorder.isTypeSupported(mime)) return mime
  }
  return ''
}

let ffmpegInstance: FFmpeg | null = null

async function getFFmpeg(): Promise<FFmpeg> {
  if (ffmpegInstance && ffmpegInstance.loaded) return ffmpegInstance
  const ffmpeg = new FFmpeg()
  const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd'
  await ffmpeg.load({
    coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
    wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
  })
  ffmpegInstance = ffmpeg
  return ffmpeg
}

async function convertToMp4(webmBlob: Blob): Promise<Blob> {
  const ffmpeg = await getFFmpeg()
  const inputData = await fetchFile(webmBlob)
  await ffmpeg.writeFile('input.webm', inputData)
  await ffmpeg.exec(['-i', 'input.webm', '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', '-movflags', '+faststart', 'output.mp4'])
  const outputData = await ffmpeg.readFile('output.mp4')
  await ffmpeg.deleteFile('input.webm')
  await ffmpeg.deleteFile('output.mp4')
  const buffer = (outputData as Uint8Array).buffer as ArrayBuffer
  return new Blob([buffer], { type: 'video/mp4' })
}

export function useVideoRecorder(): VideoRecorderState {
  const [isRecording, setIsRecording] = useState(false)
  const [recordingDuration, setRecordingDuration] = useState(0)
  const [permissionDenied, setPermissionDenied] = useState(false)
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null)
  const [videoPreviewStream, setVideoPreviewStream] = useState<MediaStream | null>(null)

  const streamRef = useRef<MediaStream | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const filenameRef = useRef('')
  const mimeRef = useRef('')

  const cleanup = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      recorderRef.current.stop()
    }
    recorderRef.current = null
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) {
        track.stop()
      }
      streamRef.current = null
    }
    setVideoPreviewStream(null)
  }, [])

  useEffect(() => cleanup, [cleanup])

  // Proactively detect denied camera permission
  useEffect(() => {
    navigator.permissions?.query({ name: 'camera' as PermissionName })
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
        video: { facingMode: 'user' },
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      })

      streamRef.current = stream
      setVideoPreviewStream(stream)
      chunksRef.current = []
      filenameRef.current = filename
      setPermissionDenied(false)
      setRecordedBlob(null)

      const mime = pickMimeType()
      mimeRef.current = mime

      const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
      recorderRef.current = recorder

      recorder.ondataavailable = (e: BlobEvent) => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data)
        }
      }

      recorder.start(1000) // collect data every second
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
    const recorder = recorderRef.current
    const mime = mimeRef.current
    const filename = filenameRef.current

    setIsRecording(false)

    if (!recorder || recorder.state === 'inactive') {
      cleanup()
      return
    }

    // MediaRecorder.stop() is async — the final data arrives in onstop
    recorder.onstop = async () => {
      const chunks = [...chunksRef.current]
      chunksRef.current = []

      if (chunks.length === 0) return

      const type = mime || 'video/webm'
      const rawBlob = new Blob(chunks, { type })

      // Convert to MP4 if the recording is WebM
      let finalBlob: Blob
      if (type.startsWith('video/mp4')) {
        finalBlob = rawBlob
      } else {
        try {
          finalBlob = await convertToMp4(rawBlob)
        } catch {
          // Fallback to raw blob if conversion fails
          finalBlob = rawBlob
        }
      }

      setRecordedBlob(finalBlob)

      if (autoDownload) {
        setTimeout(() => downloadBlob(finalBlob, `${filename}.mp4`), 0)
      }
    }

    recorder.stop()
    cleanup()
  }, [cleanup])

  const downloadRecording = useCallback(() => {
    if (!recordedBlob) return
    downloadBlob(recordedBlob, `${filenameRef.current}.mp4`)
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
    videoPreviewStream,
    startRecording,
    stopRecording,
    downloadRecording,
    clearRecording,
  }
}

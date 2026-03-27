import { useEffect, useRef, useState } from 'react'
import { Circle, Download, Mic, Square, Video } from 'lucide-react'
import { toast } from 'sonner'
import { useRecorder } from '../hooks/use-recorder'
import { useVideoRecorder } from '../hooks/use-video-recorder'
import { CameraPreview } from './CameraPreview'
import { ShareMenu } from './ShareMenu'
import { usePlayerPrefsStore } from '@/stores/player-prefs.store'
import { usePlaybackStore } from '@/stores/playback.store'
import { cn } from '@/lib/cn'

type RecordingMode = 'audio' | 'video'

interface RecordButtonProps {
  songTitle: string
  artist: string
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

function buildFilename(artist: string, songTitle: string): string {
  return `${artist}-${songTitle}-recording`
    .replace(/[^a-zA-Z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .toLowerCase()
}

/**
 * Record button for capturing user's practice audio or video.
 * Shows a mode picker (Audio / Video) on tap, then starts recording in the chosen mode.
 * Auto-record uses the store default without showing the picker.
 */
export function RecordButton({ songTitle, artist }: RecordButtonProps) {
  const audioRecorder = useRecorder()
  const videoRecorder = useVideoRecorder()
  const recordVideo = usePlayerPrefsStore((s) => s.recordVideo)

  const [showModeSelector, setShowModeSelector] = useState(false)
  const [activeMode, setActiveMode] = useState<RecordingMode | null>(null)

  // Determine which recorder to use: activeMode for manual, recordVideo for auto-record
  const useVideo = activeMode !== null ? activeMode === 'video' : recordVideo

  const {
    isRecording,
    recordingDuration,
    recordedBlob,
    stopRecording,
    downloadRecording,
  } = useVideo ? videoRecorder : audioRecorder

  const videoPreviewStream = useVideo ? videoRecorder.videoPreviewStream : null

  const autoRecord = usePlayerPrefsStore((s) => s.autoRecord)
  const autoDownloadRecordings = usePlayerPrefsStore((s) => s.autoDownloadRecordings)

  // Refs for auto-record store subscription (avoids setState in effects)
  const isRecordingRef = useRef(isRecording)
  const autoRecordRef = useRef(autoRecord)
  const autoDownloadRef = useRef(autoDownloadRecordings)
  const recordVideoRef = useRef(recordVideo)
  const audioRecorderRef = useRef(audioRecorder)
  const videoRecorderRef = useRef(videoRecorder)
  const stopRecordingRef = useRef(stopRecording)
  const artistRef = useRef(artist)
  const songTitleRef = useRef(songTitle)

  useEffect(() => { isRecordingRef.current = isRecording }, [isRecording])
  useEffect(() => { autoRecordRef.current = autoRecord }, [autoRecord])
  useEffect(() => { autoDownloadRef.current = autoDownloadRecordings }, [autoDownloadRecordings])
  useEffect(() => { recordVideoRef.current = recordVideo }, [recordVideo])
  useEffect(() => { audioRecorderRef.current = audioRecorder }, [audioRecorder])
  useEffect(() => { videoRecorderRef.current = videoRecorder }, [videoRecorder])
  useEffect(() => { stopRecordingRef.current = stopRecording }, [stopRecording])
  useEffect(() => { artistRef.current = artist }, [artist])
  useEffect(() => { songTitleRef.current = songTitle }, [songTitle])

  // Auto-record: subscribe to playback store changes
  useEffect(() => {
    let prevPlaying = usePlaybackStore.getState().isPlaying

    const unsub = usePlaybackStore.subscribe((state) => {
      const wasPlaying = prevPlaying
      prevPlaying = state.isPlaying

      if (!autoRecordRef.current) return

      if (!wasPlaying && state.isPlaying) {
        setShowModeSelector(false)
        setActiveMode(recordVideoRef.current ? 'video' : 'audio')
        const filename = buildFilename(artistRef.current, songTitleRef.current)
        const recorder = recordVideoRef.current ? videoRecorderRef.current : audioRecorderRef.current
        recorder.startRecording(filename).catch((err) => {
          if (err instanceof DOMException && err.name === 'NotAllowedError') {
            const device = recordVideoRef.current ? 'Camera' : 'Microphone'
            toast.error(`${device} access denied. Auto-record requires permissions.`)
          } else {
            toast.error('Auto-record failed to start. Please try again.')
          }
        })
      } else if (wasPlaying && !state.isPlaying && isRecordingRef.current) {
        stopRecordingRef.current(autoDownloadRef.current)
        toast.success(autoDownloadRef.current ? 'Recording saved' : 'Recording ready')
        setActiveMode(null)
      }
    })

    return unsub
  }, [])

  const handleRecordButtonClick = () => {
    if (isRecording) {
      stopRecording(autoDownloadRecordings)
      toast.success(autoDownloadRecordings ? 'Recording saved' : 'Recording ready')
      setShowModeSelector(false)
      setActiveMode(null)
      return
    }
    setShowModeSelector((prev) => !prev)
  }

  const handleModeSelect = async (mode: RecordingMode) => {
    setActiveMode(mode)
    setShowModeSelector(false)
    const recorder = mode === 'video' ? videoRecorder : audioRecorder
    try {
      await recorder.startRecording(buildFilename(artist, songTitle))
    } catch (err) {
      if (err instanceof DOMException && err.name === 'NotAllowedError') {
        const device = mode === 'video' ? 'Camera' : 'Microphone'
        toast.error(`${device} access denied. Please allow permissions and try again.`)
      } else {
        toast.error('Recording failed to start. Please try again.')
      }
      setActiveMode(null)
    }
  }

  const handleDownload = () => {
    downloadRecording()
    toast.success('Recording saved')
  }

  const showDownloadButton = !isRecording && recordedBlob !== null && !autoDownloadRecordings
  const showShareButton = !isRecording && recordedBlob !== null && useVideo

  const filename = buildFilename(artist, songTitle) + (useVideo ? '.mp4' : '.mp3')

  return (
    <div data-tour="record" className="flex items-center gap-1.5">
      <div className="relative">
        <button
          onClick={handleRecordButtonClick}
          className={cn(
            'inline-flex items-center justify-center rounded-lg w-16 h-16',
            'border transition-colors',
            'focus:outline-none focus:ring-2 focus:ring-flame-400/40 focus:ring-offset-1 focus:ring-offset-charcoal-800',
            isRecording
              ? 'bg-red-600/20 border-red-500 hover:border-red-400'
              : 'bg-charcoal-700 border-charcoal-600 hover:border-flame-400/30',
          )}
          aria-label={isRecording ? 'Stop recording' : 'Start recording'}
          data-testid="record-button"
        >
          {isRecording ? (
            <div className="flex flex-col items-center gap-0.5">
              <Square size={18} className="text-red-400 fill-red-400" />
              <span className="text-[10px] text-red-400 font-mono tabular-nums">
                {formatDuration(recordingDuration)}
              </span>
            </div>
          ) : (
            <Circle size={28} className="fill-current text-red-500 transition-colors" />
          )}
        </button>

        {showModeSelector && !isRecording && (
          <div
            className={cn(
              'absolute top-full left-1/2 -translate-x-1/2 mt-2',
              'flex flex-col w-36 rounded-lg overflow-hidden',
              'bg-charcoal-800 border border-charcoal-600 shadow-lg',
            )}
            data-testid="recording-mode-selector"
          >
            <button
              onClick={() => handleModeSelect('audio')}
              className={cn(
                'inline-flex items-center gap-2 px-4 py-3',
                'text-sm text-smoke-300 transition-colors',
                'hover:bg-charcoal-700 hover:text-flame-400',
              )}
              aria-label="Record audio"
              data-testid="mode-audio-btn"
            >
              <Mic size={18} />
              Audio
            </button>
            <div className="border-t border-charcoal-700" />
            <button
              onClick={() => handleModeSelect('video')}
              className={cn(
                'inline-flex items-center gap-2 px-4 py-3',
                'text-sm text-smoke-300 transition-colors',
                'hover:bg-charcoal-700 hover:text-flame-400',
              )}
              aria-label="Record video"
              data-testid="mode-video-btn"
            >
              <Video size={18} />
              Video
            </button>
          </div>
        )}
      </div>

      {showDownloadButton && (
        <button
          onClick={handleDownload}
          className={cn(
            'inline-flex items-center justify-center rounded-lg w-16 h-16',
            'bg-charcoal-700 border border-charcoal-600 text-flame-400/70',
            'hover:border-flame-400/30 hover:text-flame-400 transition-colors',
            'focus:outline-none focus:ring-2 focus:ring-flame-400/40 focus:ring-offset-1 focus:ring-offset-charcoal-800',
          )}
          aria-label="Download recording"
          data-testid="recording-download-button"
        >
          <Download size={22} />
        </button>
      )}

      {showShareButton && recordedBlob && (
        <ShareMenu blob={recordedBlob} filename={filename} />
      )}

      <CameraPreview stream={videoPreviewStream} />
    </div>
  )
}

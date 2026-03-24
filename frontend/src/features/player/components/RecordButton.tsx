import { useEffect, useRef } from 'react'
import { Circle, Download, Square } from 'lucide-react'
import { toast } from 'sonner'
import { useRecorder } from '../hooks/use-recorder'
import { usePlayerPrefsStore } from '@/stores/player-prefs.store'
import { usePlaybackStore } from '@/stores/playback.store'
import { cn } from '@/lib/cn'

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
 * Record button for capturing user's practice audio.
 * Supports manual recording, auto-record on playback, and conditional auto-download.
 */
export function RecordButton({ songTitle, artist }: RecordButtonProps) {
  const {
    isRecording,
    recordingDuration,
    recordedBlob,
    startRecording,
    stopRecording,
    downloadRecording,
  } = useRecorder()

  const autoRecord = usePlayerPrefsStore((s) => s.autoRecord)
  const autoDownloadRecordings = usePlayerPrefsStore((s) => s.autoDownloadRecordings)
  const isPlaying = usePlaybackStore((s) => s.isPlaying)

  const prevIsPlayingRef = useRef(isPlaying)
  const isRecordingRef = useRef(isRecording)

  useEffect(() => {
    isRecordingRef.current = isRecording
  }, [isRecording])

  // Auto-record: start/stop recording based on playback state
  useEffect(() => {
    const wasPlaying = prevIsPlayingRef.current
    prevIsPlayingRef.current = isPlaying

    if (!autoRecord) return

    if (!wasPlaying && isPlaying) {
      // Playback started → auto-start recording
      const filename = buildFilename(artist, songTitle)
      startRecording(filename).catch((err) => {
        if (err instanceof DOMException && err.name === 'NotAllowedError') {
          toast.error('Microphone access denied. Auto-record requires microphone permissions.')
        } else {
          toast.error('Auto-record failed to start. Please try again.')
        }
      })
    } else if (wasPlaying && !isPlaying && isRecordingRef.current) {
      // Playback stopped → auto-stop recording
      stopRecording(autoDownloadRecordings)
      toast.success(autoDownloadRecordings ? 'Recording saved' : 'Recording ready')
    }
  }, [isPlaying, autoRecord, autoDownloadRecordings, artist, songTitle, startRecording, stopRecording])

  const handleToggleRecording = async () => {
    if (isRecording) {
      stopRecording(autoDownloadRecordings)
      toast.success(autoDownloadRecordings ? 'Recording saved' : 'Recording ready')
      return
    }

    try {
      await startRecording(buildFilename(artist, songTitle))
    } catch (err) {
      if (err instanceof DOMException && err.name === 'NotAllowedError') {
        toast.error('Microphone access denied. Please allow microphone permissions and try again.')
      } else {
        toast.error('Recording failed to start. Please try again.')
      }
    }
  }

  const handleDownload = () => {
    downloadRecording()
    toast.success('Recording saved')
  }

  const showDownloadButton = !isRecording && recordedBlob !== null && !autoDownloadRecordings

  return (
    <div data-tour="record" className="flex items-center gap-1.5">
      <button
        onClick={handleToggleRecording}
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
    </div>
  )
}

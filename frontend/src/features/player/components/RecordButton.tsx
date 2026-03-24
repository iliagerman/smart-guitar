import { Circle, Square } from 'lucide-react'
import { toast } from 'sonner'
import { useRecorder } from '../hooks/use-recorder'
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
 * Recordings are client-side only — auto-downloads as MP3 when stopped.
 */
export function RecordButton({ songTitle, artist }: RecordButtonProps) {
  const {
    isRecording,
    recordingDuration,
    startRecording,
    stopRecording,
  } = useRecorder()

  const handleToggleRecording = async () => {
    if (isRecording) {
      stopRecording()
      toast.success('Recording saved')
      return
    }

    try {
      await startRecording(buildFilename(artist, songTitle))
    } catch {
      toast.error('Microphone access denied. Please allow microphone permissions and try again.')
    }
  }

  return (
    <div data-tour="record">
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
    </div>
  )
}

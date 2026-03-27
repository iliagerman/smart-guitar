import { Mic, Video } from 'lucide-react'
import { usePlayerPrefsStore } from '@/stores/player-prefs.store'
import { cn } from '@/lib/cn'

interface ToggleRowProps {
  label: string
  description: string
  value: boolean
  onChange: (enabled: boolean) => void
  testId: string
}

function ToggleRow({ label, description, value, onChange, testId }: ToggleRowProps) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <p className="text-smoke-100 text-sm font-medium">{label}</p>
        <p className="text-smoke-500 text-xs">{description}</p>
      </div>
      <button
        role="switch"
        aria-checked={value}
        onClick={() => onChange(!value)}
        className={cn(
          'relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors',
          value ? 'bg-flame-500' : 'bg-charcoal-600',
        )}
        data-testid={testId}
      >
        <span
          aria-hidden="true"
          className={cn(
            'pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-sm transition-transform',
            value ? 'translate-x-5' : 'translate-x-0',
          )}
        />
      </button>
    </div>
  )
}

/**
 * Recording settings section for the profile page.
 * Controls auto-record, auto-download, and auto-record mode preferences.
 */
export function RecordingSettingsSection() {
  const autoRecord = usePlayerPrefsStore((s) => s.autoRecord)
  const autoDownloadRecordings = usePlayerPrefsStore((s) => s.autoDownloadRecordings)
  const recordVideo = usePlayerPrefsStore((s) => s.recordVideo)
  const setAutoRecord = usePlayerPrefsStore((s) => s.setAutoRecord)
  const setAutoDownloadRecordings = usePlayerPrefsStore((s) => s.setAutoDownloadRecordings)
  const setRecordVideo = usePlayerPrefsStore((s) => s.setRecordVideo)

  return (
    <div className="bg-charcoal-800 rounded-xl p-6 border border-charcoal-600">
      <h2 className="text-lg font-semibold text-smoke-100 mb-4 flex items-center gap-2">
        <Mic size={20} />
        Recording
      </h2>

      <div className="space-y-4">
        <ToggleRow
          label="Auto Record"
          description="Automatically start recording when a song plays"
          value={autoRecord}
          onChange={setAutoRecord}
          testId="auto-record-toggle"
        />
        <ToggleRow
          label="Auto Download"
          description="Download recordings automatically when recording stops"
          value={autoDownloadRecordings}
          onChange={setAutoDownloadRecordings}
          testId="auto-download-toggle"
        />

        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-smoke-100 text-sm font-medium">Default Recording Mode</p>
            <p className="text-smoke-500 text-xs">Used for auto-record; manual recording always asks</p>
          </div>
          <div className="flex rounded-lg border border-charcoal-600 overflow-hidden">
            <button
              onClick={() => setRecordVideo(false)}
              className={cn(
                'inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors',
                !recordVideo
                  ? 'bg-flame-400/15 border-r border-flame-400/40 text-flame-400'
                  : 'border-r border-charcoal-600 text-smoke-500 hover:text-smoke-300',
              )}
              aria-label="Audio mode"
              data-testid="default-mode-audio-btn"
            >
              <Mic size={14} />
              Audio
            </button>
            <button
              onClick={() => setRecordVideo(true)}
              className={cn(
                'inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors',
                recordVideo
                  ? 'bg-flame-400/15 text-flame-400'
                  : 'text-smoke-500 hover:text-smoke-300',
              )}
              aria-label="Video mode"
              data-testid="default-mode-video-btn"
            >
              <Video size={14} />
              Video
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

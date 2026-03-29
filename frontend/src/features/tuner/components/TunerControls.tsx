import { Mic, MicOff } from 'lucide-react'
import { cn } from '@/lib/cn'

interface TunerControlsProps {
  isListening: boolean
  permissionDenied: boolean
  onToggle: () => void
}

export function TunerControls({ isListening, permissionDenied, onToggle }: TunerControlsProps) {
  return (
    <div className="flex flex-col items-center gap-3">
      <button
        onClick={onToggle}
        className={cn(
          'w-16 h-16 rounded-full flex items-center justify-center transition-all',
          'border-2',
          isListening
            ? 'bg-ember-500/20 border-ember-500 text-ember-400 animate-flame-pulse'
            : 'bg-flame-400/15 border-flame-400/40 text-flame-400 hover:bg-flame-400/25'
        )}
        aria-label={isListening ? 'Stop tuning' : 'Start tuning'}
        data-testid="tuner-toggle-button"
      >
        {isListening ? <MicOff size={24} /> : <Mic size={24} />}
      </button>

      <span className="text-xs text-smoke-600">
        {isListening ? 'Tap to stop' : 'Tap to start tuning'}
      </span>

      {permissionDenied && (
        <div className="mt-2 p-3 rounded-xl bg-ember-500/10 border border-ember-500/30 text-sm text-ember-400 text-center max-w-xs">
          <p className="font-semibold mb-1">Microphone access denied</p>
          <p className="text-smoke-500 text-xs">
            Enable microphone access in your browser settings and try again.
          </p>
        </div>
      )}
    </div>
  )
}

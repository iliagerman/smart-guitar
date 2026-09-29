import { Minus, Plus, Music2 } from 'lucide-react'

import { cn } from '@/lib/cn'
import { usePlayerPrefsStore } from '@/stores/player-prefs.store'
import { dockPillClass, dockStepButtonClass } from '../lib/dock-button'

export function ChordDisplayControls({ className }: { className?: string }) {
  const transposeSemitones = usePlayerPrefsStore((s) => s.transposeSemitones)
  const transposeUp = usePlayerPrefsStore((s) => s.transposeUp)
  const transposeDown = usePlayerPrefsStore((s) => s.transposeDown)
  const resetTranspose = usePlayerPrefsStore((s) => s.resetTranspose)
  const showBassNotes = usePlayerPrefsStore((s) => s.showBassNotes)
  const toggleShowBassNotes = usePlayerPrefsStore((s) => s.toggleShowBassNotes)
  const showBeatCounts = usePlayerPrefsStore((s) => s.showBeatCounts)
  const toggleShowBeatCounts = usePlayerPrefsStore((s) => s.toggleShowBeatCounts)

  return (
    <div
      className={dockPillClass(false, cn('gap-1 px-1.5', className))}
      data-testid="chord-display-controls"
      aria-label="Chord display controls"
    >
      <button
        type="button"
        className={dockStepButtonClass}
        onClick={transposeDown}
        aria-label="Transpose down"
        title="Transpose down"
      >
        <Minus size={16} />
      </button>

      <button
        type="button"
        className="inline-flex items-center gap-1.5 rounded-full px-2 py-1 transition-colors hover:bg-white/10"
        onClick={resetTranspose}
        aria-label="Reset transpose"
        title="Reset transpose"
      >
        <Music2 size={16} className="text-smoke-300" />
        <span className="font-mono text-xs text-smoke-200 whitespace-nowrap">
          {transposeSemitones === 0
            ? '0'
            : transposeSemitones > 0
              ? `+${transposeSemitones}`
              : String(transposeSemitones)}
        </span>
      </button>

      <button
        type="button"
        className={dockStepButtonClass}
        onClick={transposeUp}
        aria-label="Transpose up"
        title="Transpose up"
      >
        <Plus size={16} />
      </button>

      <span className="mx-1 h-5 w-px bg-white/10" aria-hidden="true" />

      <button
        type="button"
        className={cn(
          'inline-flex items-center justify-center rounded-full px-2 py-1 font-mono text-xs transition-colors',
          showBassNotes
            ? 'bg-fire-500/20 text-fire-200'
            : 'text-smoke-300 hover:bg-white/10',
        )}
        onClick={toggleShowBassNotes}
        aria-label="Toggle slash bass notes"
        aria-pressed={showBassNotes}
        title={showBassNotes ? 'Hide slash bass notes (C/G)' : 'Show slash bass notes (C/G)'}
        data-testid="chord-bass-toggle"
      >
        /bass
      </button>

      <button
        type="button"
        className={cn(
          'inline-flex items-center justify-center rounded-full px-2 py-1 font-mono text-xs transition-colors',
          showBeatCounts
            ? 'bg-fire-500/20 text-fire-200'
            : 'text-smoke-300 hover:bg-white/10',
        )}
        onClick={toggleShowBeatCounts}
        aria-label="Toggle beat counts under the chords"
        aria-pressed={showBeatCounts}
        title={showBeatCounts ? 'Hide the beat counts under the chords' : 'Count the beats under each chord (1 2 3 4)'}
        data-testid="chord-beat-count-toggle"
      >
        1234
      </button>
    </div>
  )
}

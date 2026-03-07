import { Minus, Plus, Music2 } from 'lucide-react'

import { cn } from '@/lib/cn'
import { usePlayerPrefsStore } from '@/stores/player-prefs.store'

export function ChordDisplayControls({ className }: { className?: string }) {
  const transposeSemitones = usePlayerPrefsStore((s) => s.transposeSemitones)
  const transposeUp = usePlayerPrefsStore((s) => s.transposeUp)
  const transposeDown = usePlayerPrefsStore((s) => s.transposeDown)
  const resetTranspose = usePlayerPrefsStore((s) => s.resetTranspose)

  return (
    <div
      className={cn(
        'inline-flex items-center rounded-lg px-1 py-1 text-xs font-medium',
        'bg-charcoal-700 border border-charcoal-600 text-smoke-100',
        'hover:border-flame-400/30 transition-colors',
        'w-auto',
        className,
      )}
      data-testid="chord-display-controls"
      aria-label="Chord display controls"
    >
      <button
        type="button"
        className="inline-flex items-center justify-center rounded p-0.5 hover:bg-charcoal-800/60 text-smoke-200 transition-colors"
        onClick={transposeDown}
        aria-label="Transpose down"
        title="Transpose down"
      >
        <Minus size={12} />
      </button>

      <button
        type="button"
        className="inline-flex items-center gap-0.5 rounded px-0.5 py-0.5 hover:bg-charcoal-800/60 transition-colors"
        onClick={resetTranspose}
        aria-label="Reset transpose"
        title="Reset transpose"
      >
        <Music2 size={12} className="text-smoke-300" />
        <span className="font-mono text-[10px] text-smoke-200 whitespace-nowrap">
          {transposeSemitones === 0
            ? '0'
            : transposeSemitones > 0
              ? `+${transposeSemitones}`
              : String(transposeSemitones)}
        </span>
      </button>

      <button
        type="button"
        className="inline-flex items-center justify-center rounded p-0.5 hover:bg-charcoal-800/60 text-smoke-200 transition-colors"
        onClick={transposeUp}
        aria-label="Transpose up"
        title="Transpose up"
      >
        <Plus size={12} />
      </button>
    </div>
  )
}

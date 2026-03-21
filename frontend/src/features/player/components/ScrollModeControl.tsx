import { ChevronsDown, Minus, Plus } from 'lucide-react'

import { cn } from '@/lib/cn'
import { usePlayerPrefsStore } from '@/stores/player-prefs.store'

const SPEED_STEP = 10

export function ScrollModeControl({ className }: { className?: string }) {
  const showHighlight = usePlayerPrefsStore((s) => s.lyricsMode !== 'none')
  const autoScrollSpeed = usePlayerPrefsStore((s) => s.autoScrollSpeed)
  const setAutoScrollSpeed = usePlayerPrefsStore((s) => s.setAutoScrollSpeed)

  if (showHighlight) return null

  return (
    <div
      className={cn(
        'inline-flex items-center rounded-lg px-1.5 py-1.5 text-sm font-medium',
        'bg-charcoal-700 border border-charcoal-600 text-smoke-100',
        'hover:border-flame-400/30 transition-colors',
        'w-auto',
        className,
      )}
      data-testid="scroll-mode-control"
      aria-label="Auto-scroll speed"
    >
      <button
        type="button"
        className="inline-flex items-center justify-center rounded p-1 hover:bg-charcoal-800/60 text-smoke-200 transition-colors"
        onClick={() => setAutoScrollSpeed(autoScrollSpeed - SPEED_STEP)}
        aria-label="Slower scroll"
        title="Slower scroll"
      >
        <Minus size={16} />
      </button>

      <ChevronsDown size={16} className="text-smoke-300" />
      <span className="font-mono text-xs text-smoke-200 whitespace-nowrap min-w-[3ch] text-center">
        {autoScrollSpeed}
      </span>

      <button
        type="button"
        className="inline-flex items-center justify-center rounded p-1 hover:bg-charcoal-800/60 text-smoke-200 transition-colors"
        onClick={() => setAutoScrollSpeed(autoScrollSpeed + SPEED_STEP)}
        aria-label="Faster scroll"
        title="Faster scroll"
      >
        <Plus size={16} />
      </button>
    </div>
  )
}

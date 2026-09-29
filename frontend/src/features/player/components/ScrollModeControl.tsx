import { ChevronsDown, Minus, Plus } from 'lucide-react'

import { cn } from '@/lib/cn'
import { usePlayerPrefsStore } from '@/stores/player-prefs.store'
import { dockPillClass, dockStepButtonClass } from '../lib/dock-button'

const SPEED_STEP = 10

export function ScrollModeControl({ className }: { className?: string }) {
  const showHighlight = usePlayerPrefsStore((s) => s.lyricsMode !== 'none')
  const autoScrollSpeed = usePlayerPrefsStore((s) => s.autoScrollSpeed)
  const setAutoScrollSpeed = usePlayerPrefsStore((s) => s.setAutoScrollSpeed)

  if (showHighlight) return null

  return (
    <div
      className={dockPillClass(false, cn('gap-1 px-1.5', className))}
      data-testid="scroll-mode-control"
      aria-label="Auto-scroll speed"
    >
      <button
        type="button"
        className={dockStepButtonClass}
        onClick={() => setAutoScrollSpeed((prev) => prev - SPEED_STEP)}
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
        className={dockStepButtonClass}
        onClick={() => setAutoScrollSpeed((prev) => prev + SPEED_STEP)}
        aria-label="Faster scroll"
        title="Faster scroll"
      >
        <Plus size={16} />
      </button>
    </div>
  )
}

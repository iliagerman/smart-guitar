import { Minus, Plus, Timer } from 'lucide-react'

import { cn } from '@/lib/cn'
import { usePlayerPrefsStore } from '@/stores/player-prefs.store'
import { dockPillClass, dockStepButtonClass } from '../lib/dock-button'

const STEP_MS = 50

interface LyricsSyncControlProps {
  songId: string
  className?: string
}

export function LyricsSyncControl({ songId, className }: LyricsSyncControlProps) {
  const lyricsOffsetMs = usePlayerPrefsStore((s) => s.lyricsOffsetMs)
  const setSongOverride = usePlayerPrefsStore((s) => s.setSongOverride)
  const setOffset = (ms: number) => {
    setSongOverride(songId, 'lyricsOffsetMs', Math.max(-2000, Math.min(2000, ms)))
  }

  return (
    <div
      className={dockPillClass(false, cn('gap-1 px-1.5', className))}
      data-testid="lyrics-sync-control"
      aria-label="Lyrics sync offset"
    >
      <button
        type="button"
        className={dockStepButtonClass}
        onClick={() => setOffset(lyricsOffsetMs - STEP_MS)}
        aria-label="Lyrics earlier"
        title="Lyrics earlier"
      >
        <Minus size={16} />
      </button>

      <button
        type="button"
        className="inline-flex items-center gap-1.5 rounded-full px-2 py-1 transition-colors hover:bg-white/10"
        onClick={() => setOffset(0)}
        aria-label="Reset lyrics sync"
        title="Reset lyrics sync"
      >
        <Timer size={16} className="text-smoke-300" />
        <span className="font-mono text-xs text-smoke-200 whitespace-nowrap">
          {lyricsOffsetMs === 0
            ? '0ms'
            : lyricsOffsetMs > 0
              ? `+${lyricsOffsetMs}ms`
              : `${lyricsOffsetMs}ms`}
        </span>
      </button>

      <button
        type="button"
        className={dockStepButtonClass}
        onClick={() => setOffset(lyricsOffsetMs + STEP_MS)}
        aria-label="Lyrics later"
        title="Lyrics later"
      >
        <Plus size={16} />
      </button>
    </div>
  )
}

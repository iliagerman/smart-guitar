import { Minus, Plus, Timer } from 'lucide-react'

import { cn } from '@/lib/cn'
import { usePlayerPrefsStore } from '@/stores/player-prefs.store'

const STEP_MS = 50

export function LyricsSyncControl({ className }: { className?: string }) {
  const lyricsOffsetMs = usePlayerPrefsStore((s) => s.lyricsOffsetMs)
  const setLyricsOffsetMs = usePlayerPrefsStore((s) => s.setLyricsOffsetMs)

  return (
    <div
      className={cn(
        'inline-flex items-center rounded-lg px-1 py-1 text-xs font-medium',
        'bg-charcoal-700 border border-charcoal-600 text-smoke-100',
        'hover:border-flame-400/30 transition-colors',
        'w-auto',
        className,
      )}
      data-testid="lyrics-sync-control"
      aria-label="Lyrics sync offset"
    >
      <button
        type="button"
        className="inline-flex items-center justify-center rounded p-0.5 hover:bg-charcoal-800/60 text-smoke-200 transition-colors"
        onClick={() => setLyricsOffsetMs(lyricsOffsetMs - STEP_MS)}
        aria-label="Lyrics earlier"
        title="Lyrics earlier"
      >
        <Minus size={12} />
      </button>

      <button
        type="button"
        className="inline-flex items-center gap-0.5 rounded px-0.5 py-0.5 hover:bg-charcoal-800/60 transition-colors"
        onClick={() => setLyricsOffsetMs(0)}
        aria-label="Reset lyrics sync"
        title="Reset lyrics sync"
      >
        <Timer size={12} className="text-smoke-300" />
        <span className="font-mono text-[10px] text-smoke-200 whitespace-nowrap">
          {lyricsOffsetMs === 0
            ? '0ms'
            : lyricsOffsetMs > 0
              ? `+${lyricsOffsetMs}ms`
              : `${lyricsOffsetMs}ms`}
        </span>
      </button>

      <button
        type="button"
        className="inline-flex items-center justify-center rounded p-0.5 hover:bg-charcoal-800/60 text-smoke-200 transition-colors"
        onClick={() => setLyricsOffsetMs(lyricsOffsetMs + STEP_MS)}
        aria-label="Lyrics later"
        title="Lyrics later"
      >
        <Plus size={12} />
      </button>
    </div>
  )
}

import { Eye, EyeOff } from 'lucide-react'

import { cn } from '@/lib/cn'
import { usePlayerPrefsStore } from '@/stores/player-prefs.store'

/**
 * Toggles between lyrics highlighting (time-synced) and plain auto-scroll mode.
 * When highlighting is off, the chord sheet scrolls at the user's chosen speed
 * without word-level highlighting.
 */
export function HighlightToggle({ className }: { className?: string }) {
  const lyricsMode = usePlayerPrefsStore((s) => s.lyricsMode)
  const setLyricsMode = usePlayerPrefsStore((s) => s.setLyricsMode)

  const isHighlight = lyricsMode !== 'none'

  return (
    <button
      type="button"
      className={cn(
        'inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium',
        'bg-charcoal-700 border border-charcoal-600',
        'hover:border-flame-400/30 transition-colors',
        'focus:outline-none focus:ring-2 focus:ring-flame-400/40 focus:ring-offset-1 focus:ring-offset-charcoal-800',
        isHighlight ? 'text-smoke-100' : 'text-smoke-400',
        className,
      )}
      onClick={() => setLyricsMode(isHighlight ? 'none' : 'highlight')}
      aria-label={isHighlight ? 'Switch to auto-scroll' : 'Switch to highlight sync'}
      title={isHighlight ? 'Highlight sync on — tap to switch to auto-scroll' : 'Auto-scroll on — tap to enable highlight sync'}
      data-testid="highlight-toggle"
    >
      {isHighlight ? <Eye size={16} /> : <EyeOff size={16} />}
      <span className="text-xs">{isHighlight ? 'Sync' : 'Scroll'}</span>
    </button>
  )
}

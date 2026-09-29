import { Eye, EyeOff } from 'lucide-react'

import { usePlayerPrefsStore } from '@/stores/player-prefs.store'
import { dockPillClass } from '../lib/dock-button'

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
      className={dockPillClass(isHighlight, className)}
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

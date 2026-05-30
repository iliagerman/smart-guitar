import { Timer, TimerOff } from 'lucide-react'

import { cn } from '@/lib/cn'
import { usePlayerPrefsStore } from '@/stores/player-prefs.store'

/**
 * Toggles the 3-2-1 count-in that plays before playback starts, giving the player
 * time to get their hands ready before the song begins.
 */
export function CountInToggle({ className }: { className?: string }) {
  const countInEnabled = usePlayerPrefsStore((s) => s.countInEnabled)
  const toggleCountInEnabled = usePlayerPrefsStore((s) => s.toggleCountInEnabled)

  return (
    <button
      type="button"
      className={cn(
        'inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium',
        'bg-charcoal-700 border border-charcoal-600',
        'hover:border-flame-400/30 transition-colors',
        'focus:outline-none focus:ring-2 focus:ring-flame-400/40 focus:ring-offset-1 focus:ring-offset-charcoal-800',
        countInEnabled ? 'text-smoke-100' : 'text-smoke-400',
        className,
      )}
      onClick={toggleCountInEnabled}
      aria-label={countInEnabled ? 'Turn off count-in' : 'Turn on count-in'}
      aria-pressed={countInEnabled}
      title={
        countInEnabled
          ? 'Count-in on — a 3-2-1 plays before the song starts'
          : 'Count-in off — playback starts immediately'
      }
      data-testid="count-in-toggle"
    >
      {countInEnabled ? <Timer size={16} /> : <TimerOff size={16} />}
      <span className="text-xs">Count-in</span>
    </button>
  )
}

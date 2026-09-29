import { Timer, TimerOff } from 'lucide-react'

import { usePlayerPrefsStore } from '@/stores/player-prefs.store'
import { dockPillClass } from '../lib/dock-button'

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
      className={dockPillClass(countInEnabled, className)}
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

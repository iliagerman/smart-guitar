import { FastForward } from 'lucide-react'

import { usePlayerPrefsStore } from '@/stores/player-prefs.store'
import { dockPillClass } from '../lib/dock-button'

interface SkipInstrumentalsToggleProps {
  className?: string
  /** True when the active sheet version has no synced lyrics to detect
   *  instrumental gaps from — the toggle is inert in that case. */
  disabled?: boolean
}

/**
 * Toggles automatic skipping of instrumental sections (solos, intros,
 * interludes) longer than 7 seconds, so practice isn't interrupted by
 * sections with nothing to sing or strum along to.
 */
export function SkipInstrumentalsToggle({ className, disabled = false }: SkipInstrumentalsToggleProps) {
  const skipInstrumentals = usePlayerPrefsStore((s) => s.skipInstrumentals)
  const toggleSkipInstrumentals = usePlayerPrefsStore((s) => s.toggleSkipInstrumentals)

  const isActive = skipInstrumentals && !disabled
  const label = skipInstrumentals ? 'Turn off skip instrumentals' : 'Turn on skip instrumentals'
  const title = disabled
    ? 'Skip instrumentals needs synced lyrics — pick a synced sheet source to use it'
    : skipInstrumentals
      ? 'Skip instrumentals on — solos and interludes over 7s are skipped automatically'
      : 'Skip instrumentals off — playback plays through solos and interludes'

  return (
    <button
      type="button"
      className={dockPillClass(isActive, className)}
      onClick={toggleSkipInstrumentals}
      disabled={disabled}
      aria-label={label}
      aria-pressed={isActive}
      title={title}
      data-testid="player-skip-instrumentals-toggle"
    >
      <FastForward size={16} />
      <span className="text-xs">Skip solos</span>
    </button>
  )
}

import { FastForward } from 'lucide-react'

import { cn } from '@/lib/cn'
import { usePlayerPrefsStore } from '@/stores/player-prefs.store'

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
      className={cn(
        'inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium',
        'bg-charcoal-700 border border-charcoal-600',
        'hover:border-flame-400/30 transition-colors',
        'focus:outline-none focus:ring-2 focus:ring-flame-400/40 focus:ring-offset-1 focus:ring-offset-charcoal-800',
        isActive ? 'text-smoke-100' : 'text-smoke-400',
        disabled && 'cursor-not-allowed opacity-50 hover:border-charcoal-600',
        className,
      )}
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

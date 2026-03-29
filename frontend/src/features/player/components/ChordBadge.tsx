import { forwardRef } from 'react'
import { cn } from '@/lib/cn'
import { getChordColor } from '@/lib/chord-colors'

interface ChordBadgeProps {
  chord: string
  isActive: boolean
  onClick?: () => void
}

/**
 * Compact chord name badge used in chord timelines and selectors.
 */
export const ChordBadge = forwardRef<HTMLButtonElement, ChordBadgeProps>(
  function ChordBadge({ chord, isActive, onClick }, ref) {
    if (chord === 'N') return null

    return (
      <button
        ref={ref}
        type="button"
        onClick={onClick}
        className={cn(
          'px-2 py-1 rounded text-xs font-mono whitespace-nowrap transition-all flex-shrink-0 border',
          isActive
            ? 'bg-flame-400/20 border-flame-400/40 scale-110 shadow-[0_0_10px_rgba(250,204,21,0.2)]'
            : 'bg-charcoal-700 border-charcoal-600 hover:border-flame-400/30',
          getChordColor(chord, 'dark')
        )}
        aria-label={`Chord ${chord}`}
        data-testid="chord-badge"
      >
        {chord}
      </button>
    )
  }
)

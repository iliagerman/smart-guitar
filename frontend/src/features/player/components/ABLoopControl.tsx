import { Repeat } from 'lucide-react'

import { cn } from '@/lib/cn'
import { usePlaybackStore } from '@/stores/playback.store'

interface ABLoopControlProps {
  className?: string
}

/**
 * Cycles the A/B section-repeat loop: tap once to mark the loop start at the
 * current playback position, tap again to mark the end and start looping
 * between them, tap a third time to clear the loop.
 */
export function ABLoopControl({ className }: ABLoopControlProps) {
  const loopStart = usePlaybackStore((s) => s.loopStart)
  const loopEnd = usePlaybackStore((s) => s.loopEnd)
  const tapLoopMarker = usePlaybackStore((s) => s.tapLoopMarker)

  const isLooping = loopStart !== null && loopEnd !== null
  const isPending = loopStart !== null && loopEnd === null

  const label = isLooping ? 'Clear A/B loop' : isPending ? 'Set loop end point' : 'Set loop start point'
  const title = isLooping
    ? 'Looping between A and B — tap to clear'
    : isPending
      ? 'Loop start set — tap again at the section end'
      : 'Tap to mark the A/B loop start at the current position'

  return (
    <button
      type="button"
      className={cn(
        'inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium',
        'bg-charcoal-700 border border-charcoal-600',
        'hover:border-flame-400/30 transition-colors',
        'focus:outline-none focus:ring-2 focus:ring-flame-400/40 focus:ring-offset-1 focus:ring-offset-charcoal-800',
        isLooping || isPending ? 'text-smoke-100' : 'text-smoke-400',
        className,
      )}
      onClick={() => tapLoopMarker(usePlaybackStore.getState().currentTime)}
      aria-label={label}
      aria-pressed={isLooping}
      title={title}
      data-testid="ab-loop-toggle"
    >
      <Repeat size={16} />
      <span className="text-xs">{isLooping ? 'A-B' : isPending ? 'A..' : 'Loop'}</span>
    </button>
  )
}

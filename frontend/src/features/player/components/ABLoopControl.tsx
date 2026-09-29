import { Repeat } from 'lucide-react'

import { usePlaybackStore } from '@/stores/playback.store'
import { dockPillClass } from '../lib/dock-button'

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
      className={dockPillClass(isLooping || isPending, className)}
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

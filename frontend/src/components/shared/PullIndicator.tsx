import { ArrowDown } from 'lucide-react'
import { LoadingSpinner } from './LoadingSpinner'

type PullState = 'idle' | 'pulling' | 'threshold' | 'refreshing'

interface PullIndicatorProps {
  state: PullState
  pullDistance: number
  threshold: number
}

export function PullIndicator({ state, pullDistance, threshold }: PullIndicatorProps) {
  if (state === 'idle' && pullDistance === 0) return null

  const progress = Math.min(1, pullDistance / threshold)
  const rotation = state === 'threshold' || state === 'refreshing' ? 180 : progress * 180

  return (
    <div
      className="flex items-center justify-center"
      style={{ height: `${pullDistance}px` }}
      aria-hidden="true"
      data-testid="pull-indicator"
    >
      {state === 'refreshing' ? (
        <LoadingSpinner size="xs" inline />
      ) : (
        <ArrowDown
          size={20}
          className="text-flame-400 transition-transform duration-150"
          style={{ transform: `rotate(${rotation}deg)`, opacity: progress }}
        />
      )}
    </div>
  )
}

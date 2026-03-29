import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/cn'

const RING_SIZE = 144
const RADIUS = 62
const STROKE = 5
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

interface ProgressRingProps {
  progress: number
  isFailed: boolean
  isCompleted: boolean
  stage: string | null
}

/**
 * Circular SVG progress ring used by ProcessButton to visualize processing progress.
 */
export function ProgressRing({ progress, isFailed, isCompleted, stage }: ProgressRingProps) {
  const dashOffset = CIRCUMFERENCE - (CIRCUMFERENCE * progress) / 100

  return (
    <div className="relative flex items-center justify-center">
      <svg
        className="absolute"
        width={RING_SIZE}
        height={RING_SIZE}
        viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`}
        aria-hidden="true"
      >
        <circle
          cx={RING_SIZE / 2}
          cy={RING_SIZE / 2}
          r={RADIUS}
          fill="none"
          stroke="currentColor"
          className="text-charcoal-700"
          strokeWidth={STROKE}
        />
        <circle
          cx={RING_SIZE / 2}
          cy={RING_SIZE / 2}
          r={RADIUS}
          fill="none"
          stroke="currentColor"
          className={cn(
            'transition-[stroke-dashoffset] duration-700 ease-out',
            isFailed ? 'text-red-400' : 'text-flame-400',
          )}
          strokeWidth={STROKE}
          strokeLinecap="round"
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={dashOffset}
          transform={`rotate(-90 ${RING_SIZE / 2} ${RING_SIZE / 2})`}
        />
      </svg>

      <div
        className="relative z-10 flex items-center justify-center rounded-full size-28 bg-charcoal-800 border-2 border-charcoal-600"
        role="status"
        aria-label={
          isCompleted
            ? 'Processing complete'
            : isFailed
              ? 'Processing failed'
              : `Processing ${Math.round(progress)}%`
        }
      >
        {isCompleted ? (
          <span className="text-flame-400 font-bold text-sm">Done!</span>
        ) : isFailed ? (
          <span className="text-red-400 font-bold text-sm">Failed</span>
        ) : (
          <div className="flex flex-col items-center gap-1">
            <span className="text-flame-400 text-lg font-bold">
              {Math.round(progress)}%
            </span>
            <span className="text-smoke-400 text-[10px] capitalize leading-tight text-center px-2">
              {stage?.replaceAll('_', ' ') || 'starting'}
            </span>
          </div>
        )}
      </div>
    </div>
  )
}

interface SpinnerRingProps {
  label: string
  sublabel: string
}

/**
 * Indeterminate spinning ring shown while audio is downloading before processing begins.
 */
export function SpinnerRing({ label, sublabel }: SpinnerRingProps) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 py-8">
      <div className="relative flex items-center justify-center">
        <svg
          className="absolute animate-spin [animation-duration:3s]"
          width={RING_SIZE}
          height={RING_SIZE}
          viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`}
          aria-hidden="true"
        >
          <circle
            cx={RING_SIZE / 2}
            cy={RING_SIZE / 2}
            r={RADIUS}
            fill="none"
            stroke="currentColor"
            className="text-charcoal-700"
            strokeWidth={STROKE}
          />
          <circle
            cx={RING_SIZE / 2}
            cy={RING_SIZE / 2}
            r={RADIUS}
            fill="none"
            stroke="currentColor"
            className="text-flame-400"
            strokeWidth={STROKE}
            strokeLinecap="round"
            strokeDasharray={CIRCUMFERENCE}
            strokeDashoffset={CIRCUMFERENCE * 0.75}
            transform={`rotate(-90 ${RING_SIZE / 2} ${RING_SIZE / 2})`}
          />
        </svg>
        <div
          className="relative z-10 flex items-center justify-center rounded-full size-28 bg-charcoal-800 border-2 border-charcoal-600"
          role="status"
          aria-label={label}
        >
          <Loader2 size={24} className="animate-spin text-flame-400" />
        </div>
      </div>
      <div className="text-center space-y-1">
        <p className="text-smoke-300 text-sm">{label}</p>
        <p className="text-smoke-500 text-xs">{sublabel}</p>
      </div>
    </div>
  )
}

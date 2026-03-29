import { cn } from '@/lib/cn'
import { Minus, Plus } from 'lucide-react'

interface TuningOffsetSelectorProps {
  offset: number
  onChange: (offset: number) => void
}

const MIN_OFFSET = -5
const MAX_OFFSET = 5

function formatOffset(offset: number): string {
  if (offset === 0) return 'Standard'
  const sign = offset > 0 ? '+' : ''
  return `${sign}${offset} semitone${Math.abs(offset) !== 1 ? 's' : ''}`
}

export function TuningOffsetSelector({ offset, onChange }: TuningOffsetSelectorProps) {
  return (
    <div className="w-full max-w-xs mx-auto space-y-1">
      <div className="flex items-center justify-center gap-3">
        <button
          onClick={() => onChange(Math.max(MIN_OFFSET, offset - 1))}
          disabled={offset <= MIN_OFFSET}
          className={cn(
            'w-9 h-9 rounded-xl border flex items-center justify-center transition-colors',
            offset <= MIN_OFFSET
              ? 'border-charcoal-800 text-smoke-700 cursor-not-allowed'
              : 'border-charcoal-700 text-smoke-400 hover:border-charcoal-600 hover:text-smoke-200'
          )}
          aria-label="Decrease tuning offset"
          data-testid="tuning-offset-decrease"
        >
          <Minus size={16} />
        </button>

        <span className="text-sm font-semibold text-smoke-300 min-w-[120px] text-center">
          {formatOffset(offset)}
        </span>

        <button
          onClick={() => onChange(Math.min(MAX_OFFSET, offset + 1))}
          disabled={offset >= MAX_OFFSET}
          className={cn(
            'w-9 h-9 rounded-xl border flex items-center justify-center transition-colors',
            offset >= MAX_OFFSET
              ? 'border-charcoal-800 text-smoke-700 cursor-not-allowed'
              : 'border-charcoal-700 text-smoke-400 hover:border-charcoal-600 hover:text-smoke-200'
          )}
          aria-label="Increase tuning offset"
          data-testid="tuning-offset-increase"
        >
          <Plus size={16} />
        </button>
      </div>
    </div>
  )
}

import { cn } from '@/lib/cn'
import { type GuitarString } from '../lib/tuning'

interface StringSelectorProps {
  selectedString: GuitarString | null
  nearestString: GuitarString | null
  active: boolean
  tuning: GuitarString[]
  onSelect: (s: GuitarString | null) => void
}

export function StringSelector({
  selectedString,
  nearestString,
  active,
  tuning,
  onSelect,
}: StringSelectorProps) {
  const highlightedString = selectedString || (active ? nearestString : null)

  return (
    <div className="w-full max-w-xs mx-auto space-y-2">
      <div className="flex gap-1.5 justify-center">
        {/* Auto button */}
        <button
          onClick={() => onSelect(null)}
          className={cn(
            'px-3 py-2 rounded-xl text-sm font-semibold border transition-colors',
            selectedString === null
              ? 'bg-flame-400/15 border-flame-400/40 text-flame-400'
              : 'border-charcoal-700 text-smoke-500 hover:border-charcoal-600 hover:text-smoke-300'
          )}
          aria-label="Auto-detect string"
          data-testid="string-auto-button"
        >
          Auto
        </button>

        {/* String buttons */}
        {tuning.map((str) => {
          const isSelected = selectedString?.stringNumber === str.stringNumber
          const isDetected =
            !selectedString && active && nearestString?.stringNumber === str.stringNumber

          return (
            <button
              key={str.stringNumber}
              onClick={() => onSelect(str)}
              className={cn(
                'w-11 h-11 rounded-xl text-sm font-semibold border transition-colors',
                isSelected
                  ? 'bg-flame-400/15 border-flame-400/40 text-flame-400'
                  : isDetected
                    ? 'bg-flame-400/10 border-flame-400/20 text-smoke-200'
                    : 'border-charcoal-700 text-smoke-500 hover:border-charcoal-600 hover:text-smoke-300'
              )}
              aria-label={`Select string ${str.stringNumber} (${str.note})`}
              aria-pressed={isSelected}
              data-testid={`string-${str.stringNumber}-button`}
            >
              <div className="text-base leading-none">{str.note}</div>
              <div className="text-[10px] leading-none text-smoke-600 mt-0.5">
                {str.stringNumber}
              </div>
            </button>
          )
        })}
      </div>

      {/* Target indicator */}
      {highlightedString && (
        <p className="text-center text-xs text-smoke-600">
          {highlightedString.name} — {highlightedString.frequency} Hz
        </p>
      )}
    </div>
  )
}

import { cn } from '@/lib/cn'
import { STANDARD_TUNING, type GuitarString } from '../lib/tuning'

interface StringSelectorProps {
  selectedString: GuitarString | null
  nearestString: GuitarString | null
  active: boolean
  onSelect: (s: GuitarString | null) => void
}

export function StringSelector({
  selectedString,
  nearestString,
  active,
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
        >
          Auto
        </button>

        {/* String buttons */}
        {STANDARD_TUNING.map((str) => {
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

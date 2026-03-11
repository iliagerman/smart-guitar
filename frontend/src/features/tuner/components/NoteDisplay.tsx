import { cn } from '@/lib/cn'
import type { DetectedNote } from '../lib/tuning'
import type { GuitarString } from '../lib/tuning'

interface NoteDisplayProps {
  detectedNote: DetectedNote | null
  detectedFrequency: number | null
  cents: number
  selectedString: GuitarString | null
  nearestString: GuitarString | null
  active: boolean
}

function getCentsColor(cents: number) {
  const abs = Math.abs(cents)
  if (abs <= 5) return 'text-green-400'
  if (abs <= 15) return 'text-amber-400'
  return 'text-red-400'
}

export function NoteDisplay({
  detectedNote,
  detectedFrequency,
  cents,
  selectedString,
  nearestString,
  active,
}: NoteDisplayProps) {
  const targetString = selectedString || nearestString
  const displayNote = detectedNote?.note ?? '—'
  const displayOctave = detectedNote?.octave ?? ''

  return (
    <div className="text-center space-y-1">
      {/* Note name */}
      <div className="flex items-baseline justify-center gap-1">
        <span
          className={cn(
            'text-7xl font-display tracking-wide transition-colors',
            active && detectedNote ? getCentsColor(cents) : 'text-smoke-600'
          )}
        >
          {displayNote}
        </span>
        {detectedNote && (
          <span className="text-2xl font-display text-smoke-400">{displayOctave}</span>
        )}
      </div>

      {/* Frequency info */}
      <div className="text-sm text-smoke-500 space-x-3">
        {active && detectedFrequency ? (
          <>
            <span>{detectedFrequency} Hz</span>
            {targetString && (
              <>
                <span className="text-smoke-700">|</span>
                <span>
                  Target: {targetString.name} ({targetString.frequency} Hz)
                </span>
              </>
            )}
          </>
        ) : (
          <span>Play a string to begin</span>
        )}
      </div>

      {/* Cents deviation */}
      {active && detectedNote && (
        <div className={cn('text-lg font-semibold', getCentsColor(cents))}>
          {cents > 0 ? '+' : ''}
          {Math.round(cents)} cents
        </div>
      )}
    </div>
  )
}

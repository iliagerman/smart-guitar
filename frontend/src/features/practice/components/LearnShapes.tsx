import { Check } from 'lucide-react'
import { cn } from '@/lib/cn'
import { formatChordName } from '@/lib/chord-colors'
import { getPrimaryVoicing } from '@/features/player/lib/chord-shapes'
import { splitSlashBass } from '@/features/player/lib/chord-voicings'
import { Fretboard } from '@/features/player/components/Fretboard'

interface LearnShapesProps {
  shapes: string[]
  learned: string[]
  currentChord: string | null
  onToggle: (chord: string) => void
}

/**
 * The song's shapes as notebook cards: tick each one you can play. The chord
 * sounding right now is outlined so the cards follow the looped verse.
 */
export function LearnShapes({ shapes, learned, currentChord, onToggle }: LearnShapesProps) {
  return (
    <div className="flex gap-2 overflow-x-auto pb-1" data-testid="learn-shapes">
      {shapes.map((chord) => {
        const label = formatChordName(chord)
        const voicing = getPrimaryVoicing(splitSlashBass(label).root)
        const isLearned = learned.includes(chord)
        return (
          <button
            key={chord}
            type="button"
            onClick={() => onToggle(chord)}
            aria-pressed={isLearned}
            aria-label={`${label}: ${isLearned ? 'learned' : 'not learned yet'}`}
            className={cn(
              'relative w-[4.75rem] shrink-0 rounded-xl border-2 bg-paper-50 p-1 text-ink-900 transition-[border-color,box-shadow] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-flame-400/70',
              currentChord === chord ? 'border-fire-500 shadow-[0_6px_18px_rgba(249,115,22,0.35)]' : 'border-transparent',
            )}
            data-testid={`learn-shape-${label}`}
          >
            {isLearned && (
              <span className="absolute -right-1.5 -top-1.5 grid size-5 place-items-center rounded-full bg-green-600 text-white" aria-hidden="true">
                <Check size={12} strokeWidth={3} />
              </span>
            )}
            <span className="block font-mono text-sm font-extrabold" dir="ltr">{label}</span>
            {voicing ? (
              <span className="mt-1 block rounded-lg bg-stage-900 p-1">
                <Fretboard voicing={voicing} rowHeight={9} className="pl-2.5" />
              </span>
            ) : (
              <span className="mt-1 block text-[10px] text-ink-600">no diagram</span>
            )}
          </button>
        )
      })}
    </div>
  )
}

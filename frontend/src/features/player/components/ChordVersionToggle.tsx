import { Guitar } from 'lucide-react'

import { cn } from '@/lib/cn'

export type ChordVersion = 'v1' | 'v2'

interface ChordVersionToggleProps {
  className?: string
  hasV1: boolean
  hasV2: boolean
  selected: ChordVersion
  onSelect: (version: ChordVersion) => void
}

const LABELS: Record<ChordVersion, { short: string; tooltip: string }> = {
  v1: { short: 'V1', tooltip: 'V1: Auto-detected chords (basic)' },
  v2: { short: 'V2', tooltip: 'V2: AI-improved chords (recommended)' },
}

export function ChordVersionToggle({
  className,
  hasV1,
  hasV2,
  selected,
  onSelect,
}: ChordVersionToggleProps) {
  if (!hasV1 || !hasV2) return null

  const current = LABELS[selected]

  function cycleNext() {
    onSelect(selected === 'v2' ? 'v1' : 'v2')
  }

  return (
    <button
      type="button"
      className={cn(
        'inline-flex items-center justify-center rounded-lg w-16 h-16 relative',
        'bg-charcoal-700 border border-charcoal-600',
        selected === 'v2' ? 'text-emerald-400/70 hover:text-emerald-400' : 'text-smoke-400 hover:text-smoke-300',
        'hover:border-flame-400/30 transition-colors',
        'focus:outline-none focus:ring-2 focus:ring-flame-400/40 focus:ring-offset-1 focus:ring-offset-charcoal-800',
        className,
      )}
      onClick={cycleNext}
      title={`${current.tooltip}. Click to switch.`}
      aria-label={`Chord version: ${current.short}`}
      data-testid="chord-version-toggle"
    >
      <div className="flex flex-col items-center gap-0.5">
        <Guitar size={24} />
        <span className="text-[10px] font-bold leading-none">{current.short}</span>
      </div>
    </button>
  )
}

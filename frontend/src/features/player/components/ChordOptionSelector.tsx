import { SlidersHorizontal } from 'lucide-react'

import { cn } from '@/lib/cn'
import { usePlaybackStore } from '@/stores/playback.store'
import { type ChordOption } from '@/types/song'

interface ChordOptionSelectorProps {
  chordOptions: ChordOption[]
  hasTabs?: boolean
}

interface OptionEntry {
  key: string
  label: string
  capo: number
  apply: () => void
}

export function ChordOptionSelector({ chordOptions, hasTabs = false }: ChordOptionSelectorProps) {
  const selectedChordOptionIndex = usePlaybackStore((s) => s.selectedChordOptionIndex)
  const setSelectedChordOptionIndex = usePlaybackStore((s) => s.setSelectedChordOptionIndex)
  const sheetMode = usePlaybackStore((s) => s.sheetMode)
  const setSheetMode = usePlaybackStore((s) => s.setSheetMode)

  if (chordOptions.length === 0 && !hasTabs) return null

  // Build cycle list
  const entries: OptionEntry[] = [
    {
      key: 'standard',
      label: 'Standard',
      capo: 0,
      apply: () => {
        setSheetMode('chords')
        setSelectedChordOptionIndex(null)
      },
    },
    ...chordOptions.map((option, index) => ({
      key: String(index),
      label: option.name,
      capo: option.capo,
      apply: () => {
        setSheetMode('chords')
        setSelectedChordOptionIndex(index)
      },
    })),
  ]

  // Find current index
  const currentKey =
    sheetMode === 'tabs'
      ? 'standard'
      : selectedChordOptionIndex !== null
        ? String(selectedChordOptionIndex)
        : 'standard'

  const currentIdx = entries.findIndex((e) => e.key === currentKey)
  const current = entries[currentIdx >= 0 ? currentIdx : 0]

  function cycleNext() {
    const nextIdx = ((currentIdx >= 0 ? currentIdx : 0) + 1) % entries.length
    entries[nextIdx].apply()
  }

  return (
    <div className="flex items-center gap-1 min-w-0" data-testid="chord-option-selector">
      <button
        type="button"
        className={cn(
          'inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium',
          'bg-charcoal-700 border border-charcoal-600 text-smoke-100',
          'hover:border-flame-400/30 transition-colors',
          'outline-none focus:ring-1 focus:ring-flame-400/40',
        )}
        onClick={cycleNext}
        title={`Chords: ${current.label}. Click to cycle.`}
        aria-label={`Chord option: ${current.label}`}
      >
        <SlidersHorizontal size={16} className="text-smoke-300" />
        <span className="truncate">{current.label}</span>
      </button>
      {current.capo > 0 && (
        <span className="bg-flame-400/20 text-flame-400 text-xs px-1.5 py-0.5 rounded">
          Capo {current.capo}
        </span>
      )}
    </div>
  )
}

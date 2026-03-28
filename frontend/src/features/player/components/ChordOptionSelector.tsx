import { SlidersHorizontal } from 'lucide-react'

import { cn } from '@/lib/cn'
import { usePlaybackStore } from '@/stores/playback.store'
import { type ChordOption } from '@/types/song'

interface ChordOptionSelectorProps {
  chordOptions: ChordOption[]
  hasTabs?: boolean
  recommendedCapo?: number | null
  songKey?: string | null
  chordSource?: string | null
}

interface OptionEntry {
  key: string
  label: string
  capo: number
  apply: () => void
}

export function ChordOptionSelector({ chordOptions, hasTabs = false, recommendedCapo, songKey, chordSource }: ChordOptionSelectorProps) {
  const selectedChordOptionIndex = usePlaybackStore((s) => s.selectedChordOptionIndex)
  const setSelectedChordOptionIndex = usePlaybackStore((s) => s.setSelectedChordOptionIndex)
  const sheetMode = usePlaybackStore((s) => s.sheetMode)
  const setSheetMode = usePlaybackStore((s) => s.setSheetMode)

  if (chordOptions.length === 0 && !hasTabs) return null

  // Build cycle list — primary chords labeled by source
  const primaryLabel = chordSource === 'gemini' ? 'Chords (V2)' : chordSource === 'autochord' ? 'Chords (V1)' : 'Standard'
  const entries: OptionEntry[] = [
    {
      key: 'standard',
      label: primaryLabel,
      capo: recommendedCapo ?? 0,
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

  // Add tabs option when tabs are available
  if (hasTabs) {
    entries.push({
      key: 'tabs',
      label: 'Tabs',
      capo: 0,
      apply: () => {
        setSheetMode('tabs')
        setSelectedChordOptionIndex(null)
      },
    })
  }

  // Find current index
  const currentKey =
    sheetMode === 'tabs'
      ? 'tabs'
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
      {(current.capo > 0 || (recommendedCapo && recommendedCapo > 0)) && (
        <span
          className="bg-flame-400/20 text-flame-400 text-xs px-1.5 py-0.5 rounded"
          data-testid="chord-capo-badge"
        >
          Capo {current.capo > 0 ? current.capo : recommendedCapo}
        </span>
      )}
      {songKey && (
        <span
          className="bg-emerald-400/20 text-emerald-400 text-xs px-1.5 py-0.5 rounded"
          data-testid="chord-key-badge"
        >
          Key: {songKey}
        </span>
      )}
    </div>
  )
}

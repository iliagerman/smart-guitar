import { useMemo } from 'react'
import { SlidersHorizontal } from 'lucide-react'

import { cn } from '@/lib/cn'
import { usePlaybackStore } from '@/stores/playback.store'
import { usePlayerPrefsStore } from '@/stores/player-prefs.store'
import { findBestCapoFrets } from '@/lib/chord-simplifier'
import type { ChordEntry } from '@/types/song'

interface ChordOptionSelectorProps {
  activeChords: ChordEntry[]
  hasTabs?: boolean
}

interface OptionEntry {
  key: string
  label: string
  apply: () => void
}

export function ChordOptionSelector({ activeChords, hasTabs = false }: ChordOptionSelectorProps) {
  const chordDisplayMode = usePlaybackStore((s) => s.chordDisplayMode)
  const chordCapoFret = usePlaybackStore((s) => s.chordCapoFret)
  const sheetMode = usePlaybackStore((s) => s.sheetMode)
  const setSheetMode = usePlaybackStore((s) => s.setSheetMode)
  const setChordDisplayMode = usePlaybackStore((s) => s.setChordDisplayMode)
  const currentSongId = usePlaybackStore((s) => s.currentSongId)
  const setSongOverride = usePlayerPrefsStore((s) => s.setSongOverride)

  const bestCapoFrets = useMemo(
    () => (activeChords.length > 0 ? findBestCapoFrets(activeChords) : []),
    [activeChords],
  )

  const persistChordOption = (mode: 'standard' | 'beginner' | 'capo', fret: number, sheet: 'chords' | 'tabs') => {
    if (!currentSongId) return
    setSongOverride(currentSongId, 'chordDisplayMode', mode)
    setSongOverride(currentSongId, 'chordCapoFret', fret)
    setSongOverride(currentSongId, 'sheetMode', sheet)
  }

  const entries = useMemo(() => {
    const list: OptionEntry[] = [
      {
        key: 'standard',
        label: 'Chords',
        apply: () => {
          setSheetMode('chords')
          setChordDisplayMode('standard')
          persistChordOption('standard', 0, 'chords')
        },
      },
      {
        key: 'beginner',
        label: 'Beginner',
        apply: () => {
          setSheetMode('chords')
          setChordDisplayMode('beginner')
          persistChordOption('beginner', 0, 'chords')
        },
      },
    ]

    for (const { fret } of bestCapoFrets) {
      list.push({
        key: `capo-${fret}`,
        label: `Capo ${fret}`,
        apply: () => {
          setSheetMode('chords')
          setChordDisplayMode('capo', fret)
          persistChordOption('capo', fret, 'chords')
        },
      })
    }

    if (hasTabs) {
      list.push({
        key: 'tabs',
        label: 'Tabs',
        apply: () => {
          setSheetMode('tabs')
          setChordDisplayMode('standard')
          persistChordOption('standard', 0, 'tabs')
        },
      })
    }

    return list
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bestCapoFrets, hasTabs, setSheetMode, setChordDisplayMode, currentSongId, setSongOverride])

  if (entries.length < 2) return null

  const currentKey =
    sheetMode === 'tabs'
      ? 'tabs'
      : chordDisplayMode === 'capo'
        ? `capo-${chordCapoFret}`
        : chordDisplayMode

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
        title={`${current.label}. Click to cycle.`}
        aria-label={`Chord option: ${current.label}`}
      >
        <SlidersHorizontal size={16} className="text-smoke-300" />
        <span className="truncate">{current.label}</span>
      </button>
    </div>
  )
}

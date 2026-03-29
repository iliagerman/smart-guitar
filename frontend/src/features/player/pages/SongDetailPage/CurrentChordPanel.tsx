import { useMemo } from 'react'
import { usePlaybackStore } from '@/stores/playback.store'
import { ChordDiagram } from '../../components/ChordMap'

interface ChordEntry {
  chord: string
  start_time: number
  end_time: number
}

interface CurrentChordPanelProps {
  chords: ChordEntry[]
}

/**
 * Shows the currently playing chord diagram in the sidebar on large screens.
 * Picks the active chord based on playback time, falling back to the most recent non-N chord.
 */
export function CurrentChordPanel({ chords }: CurrentChordPanelProps) {
  const currentTime = usePlaybackStore((s) => s.currentTime)
  const displayChord = useMemo(() => {
    const active = chords.find(
      (c) => currentTime >= c.start_time && currentTime < c.end_time && c.chord !== 'N'
    )
    if (active?.chord) return active.chord

    for (let i = chords.length - 1; i >= 0; i--) {
      const c = chords[i]
      if (c.chord !== 'N' && currentTime >= c.start_time) return c.chord
    }

    return null
  }, [chords, currentTime])

  if (!displayChord) return null

  return (
    <div className="hidden lg:block w-48 shrink-0" data-testid="current-chord-panel">
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-smoke-200">Current Chord</h3>
        </div>
        <ChordDiagram chord={displayChord} />
      </div>
    </div>
  )
}

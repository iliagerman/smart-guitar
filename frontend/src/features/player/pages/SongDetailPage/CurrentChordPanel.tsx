import { formatChordWithBass } from '@/lib/chord-colors'
import { usePlayerPrefsStore } from '@/stores/player-prefs.store'
import type { ChordEntry } from '@/types/song'
import { ChordDiagram } from '../../components/ChordMap'
import { useCurrentChord } from '../../hooks/use-current-chord'

interface CurrentChordPanelProps {
  chords: ChordEntry[]
}

/**
 * Shows the currently playing chord diagram in the sidebar on large screens.
 * Picks the active chord based on playback time, falling back to the most
 * recent non-N chord. The label carries the slash bass (e.g. C/G) when
 * detected; the fingering diagram stays the root chord shape.
 */
export function CurrentChordPanel({ chords }: CurrentChordPanelProps) {
  const showBassNotes = usePlayerPrefsStore((s) => s.showBassNotes)
  // Cursor-based: scans forward from the last known chord each tick instead
  // of re-scanning the whole chords array, and only re-renders this
  // component when the displayed chord entry actually changes.
  const displayChord = useCurrentChord(chords)

  if (!displayChord) return null

  const label = formatChordWithBass(displayChord.chord, displayChord.bass, showBassNotes)

  return (
    <div className="hidden lg:block w-48 shrink-0" data-testid="current-chord-panel">
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-smoke-200">Current Chord</h3>
          <span className="text-sm font-bold text-flame-300" data-testid="current-chord-label">{label}</span>
        </div>
        <ChordDiagram chord={displayChord.chord} />
      </div>
    </div>
  )
}

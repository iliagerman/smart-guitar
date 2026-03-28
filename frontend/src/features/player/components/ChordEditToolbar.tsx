import { Save, X, Trash2 } from 'lucide-react'
import { useChordEditStore } from '@/stores/chord-edit.store'
import { cn } from '@/lib/cn'

interface ChordEditToolbarProps {
  onSave: () => void
  isSaving: boolean
}

export function ChordEditToolbar({ onSave, isSaving }: ChordEditToolbarProps) {
  const exitEditMode = useChordEditStore((s) => s.exitEditMode)
  const dirty = useChordEditStore((s) => s.dirty)
  const selectedChordIndex = useChordEditStore((s) => s.selectedChordIndex)
  const editingChords = useChordEditStore((s) => s.editingChords)
  const updateChordLabel = useChordEditStore((s) => s.updateChordLabel)
  const updateChordTime = useChordEditStore((s) => s.updateChordTime)
  const deleteChord = useChordEditStore((s) => s.deleteChord)
  const selectChord = useChordEditStore((s) => s.selectChord)

  const selectedChord = selectedChordIndex !== null ? editingChords[selectedChordIndex] : null

  return (
    <div
      className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-flame-400/40 bg-charcoal-800/60 px-3 py-2"
      data-testid="chord-edit-toolbar"
    >
      {selectedChord && selectedChordIndex !== null && (
        <div className="flex items-center gap-1.5 border-l border-charcoal-600 pl-2">
          <label htmlFor="chord-edit-label" className="text-xs text-smoke-400">
            Chord:
          </label>
          <input
            id="chord-edit-label"
            type="text"
            value={selectedChord.chord}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              updateChordLabel(selectedChordIndex, e.target.value)
            }
            className="w-16 rounded bg-charcoal-700 border border-charcoal-600 px-2 py-1 text-sm text-smoke-100 outline-none focus:border-flame-400/50"
            data-testid="chord-edit-label-input"
          />
          <label htmlFor="chord-edit-time" className="text-xs text-smoke-400">
            Time:
          </label>
          <input
            id="chord-edit-time"
            type="number"
            step={0.1}
            min={0}
            value={selectedChord.start_time.toFixed(1)}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              updateChordTime(selectedChordIndex, parseFloat(e.target.value) || 0)
            }
            className="w-20 rounded bg-charcoal-700 border border-charcoal-600 px-2 py-1 text-sm text-smoke-100 outline-none focus:border-flame-400/50"
            data-testid="chord-edit-time-input"
          />
          <span className="text-xs text-smoke-500">
            → {selectedChord.end_time.toFixed(1)}s
          </span>
          <button
            type="button"
            onClick={() => {
              deleteChord(selectedChordIndex)
              selectChord(null)
            }}
            className="rounded p-1 text-red-400 hover:bg-red-400/10 transition-colors"
            aria-label="Delete selected chord"
            data-testid="chord-edit-delete-btn"
          >
            <Trash2 size={14} />
          </button>
        </div>
      )}

      <div className="ml-auto flex items-center gap-1.5">
        <button
          type="button"
          onClick={exitEditMode}
          className={cn(
            'inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-sm font-medium',
            'bg-charcoal-700 border border-charcoal-600 text-smoke-300',
            'hover:border-smoke-500 transition-colors',
          )}
          data-testid="chord-edit-cancel-btn"
        >
          <X size={14} />
          Cancel
        </button>
        <button
          type="button"
          onClick={onSave}
          disabled={!dirty || isSaving}
          className={cn(
            'inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-sm font-medium',
            'bg-flame-500 text-charcoal-950 border border-flame-400',
            'hover:bg-flame-400 transition-colors',
            'disabled:opacity-40 disabled:cursor-not-allowed',
          )}
          data-testid="chord-edit-save-btn"
        >
          <Save size={14} />
          {isSaving ? 'Saving...' : 'Save'}
        </button>
      </div>
    </div>
  )
}

import { usePlaybackStore } from '@/stores/playback.store'
import { usePlayerPrefsStore } from '@/stores/player-prefs.store'

/**
 * Says loudly that the sheet is in capo shapes, above the chords: easy to miss
 * otherwise, as songs that suggest a capo open with it on. One tap goes back
 * to the chords as recorded, and that choice is kept for the song.
 */
export function CapoBanner() {
  const mode = usePlaybackStore((s) => s.chordDisplayMode)
  const fret = usePlaybackStore((s) => s.chordCapoFret)
  const songId = usePlaybackStore((s) => s.currentSongId)
  if (mode !== 'capo' || fret <= 0) return null

  const playWithoutCapo = () => {
    usePlaybackStore.getState().setChordDisplayMode('standard', 0)
    if (!songId) return
    const { setSongOverride } = usePlayerPrefsStore.getState()
    setSongOverride(songId, 'chordDisplayMode', 'standard')
    setSongOverride(songId, 'chordCapoFret', 0)
  }

  return (
    <div
      className="flex shrink-0 items-center gap-2.5 border-b border-fire-500/30 bg-gradient-to-r from-fire-500/25 via-fire-500/12 to-transparent px-3 py-1.5 lg:px-5"
      role="status"
      data-testid="capo-banner"
    >
      <span className="shrink-0 rounded-full bg-gradient-to-br from-fire-400 to-fire-600 px-2.5 py-0.5 font-display text-base tracking-wide text-white shadow-[0_4px_14px_rgba(249,115,22,0.45)]">
        Capo {fret}
      </span>
      <p className="min-w-0 flex-1 truncate text-xs font-semibold text-flame-100 sm:text-sm">
        Put a capo on fret {fret}<span className="font-normal text-smoke-300 max-sm:hidden"> · the chords below are the shapes to play</span>
      </p>
      <button
        type="button"
        onClick={playWithoutCapo}
        className="shrink-0 rounded-full border border-white/15 px-2.5 py-1 text-[11px] font-semibold text-smoke-200 transition-colors hover:border-fire-400/40 hover:text-smoke-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-flame-400/60"
        data-testid="capo-banner-off"
      >
        No capo
      </button>
    </div>
  )
}

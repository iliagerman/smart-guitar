import { X } from 'lucide-react'

import { MetronomePanel } from '@/features/metronome/components/MetronomePanel'
import { songBeatTimes, songTempoBpm } from '@/features/metronome/lib/song-beat-grid'
import { usePlaybackStore } from '@/stores/playback.store'
import { useSongViewStore } from '@/stores/song-view.store'
import type { SongDetail } from '@/types/song'

interface SongMetronomeProps {
  detail: SongDetail
  onClose: () => void
}

/**
 * The metronome as a strip above the chord sheet, clicking on the song's
 * beats. It stays mounted while open, so its settings survive play and pause.
 * Owns the per-tick time subscription so nothing else re-renders with it.
 */
export function SongMetronome({ detail, onClose }: SongMetronomeProps) {
  const currentTime = usePlaybackStore((s) => s.currentTime)
  const isPlaying = usePlaybackStore((s) => s.isPlaying)
  const playbackRate = usePlaybackStore((s) => s.playbackRate)
  // While the song fills the screen, just the beat and the tempo; settings return on pause.
  const minimal = useSongViewStore((s) => s.immersive)

  return (
    <div
      className="flex shrink-0 items-start gap-2 border-b border-white/[0.06] bg-black/15 px-3 py-2"
      role="region"
      aria-label="Metronome"
      data-testid="song-metronome"
    >
      <MetronomePanel
        autoBpm={songTempoBpm(detail)}
        autoTimeSignature={detail.time_signature ?? null}
        autoBeatTimes={songBeatTimes(detail)}
        autoBeatAccents={detail.tab_rhythm?.beat_accents ?? null}
        mode="playback"
        playbackTime={currentTime}
        playbackPlaying={isPlaying}
        playbackRate={playbackRate}
        compact
        minimal={minimal}
      />
      <button
        type="button"
        onClick={onClose}
        className="grid size-8 shrink-0 place-items-center rounded-full border border-white/10 bg-white/[0.06] text-smoke-300 transition-colors hover:bg-white/10 hover:text-smoke-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-flame-400/60"
        aria-label="Close metronome"
      >
        <X size={15} aria-hidden="true" />
      </button>
    </div>
  )
}

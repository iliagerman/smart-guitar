import { Heart, Pause, Play, SkipBack, SkipForward } from 'lucide-react'
import { Collapse } from '@/components/shared/Collapse'
import { usePlaybackStore } from '@/stores/playback.store'
import { SongFeedback } from '../../components/SongFeedback'
import { AdminMenu } from './AdminMenu'
import { cn } from '@/lib/cn'
import { DifficultyBadge } from '@/features/library/components/DifficultyBadge'
import type { Song } from '@/types/song'

interface SongHeaderProps {
  songId: string
  title: string
  artist: string
  /** Practice tags (difficulty, easy shapes, capo, tempo) shown under the title. */
  song?: Song
  /** The tempo the metronome and bars follow; wins over the stored estimate. */
  bpm?: number | null
  /** Song tools (record, mixer, …) on the right of the title. */
  actions?: React.ReactNode
  /** Playing on a phone: the tools fold away so the sheet gets the screen. */
  actionsHidden?: boolean
  isFavorited: boolean
  onToggleFavorite: () => void
  thumbnailSrc: string
  isAdmin: boolean
  isPlaying: boolean
  isPlaybackDisabled?: boolean
  onTogglePlay: () => void
  onSeek: (time: number) => void
  onThumbnailError: () => void
}

/**
 * Displays the song title, artist, thumbnail, and mobile transport buttons.
 */
export function SongHeader({
  songId,
  title,
  artist,
  song,
  bpm,
  actions,
  actionsHidden = false,
  isFavorited,
  onToggleFavorite,
  thumbnailSrc,
  isAdmin,
  isPlaying,
  isPlaybackDisabled = false,
  onTogglePlay,
  onSeek,
  onThumbnailError,
}: SongHeaderProps) {
  const shapes = song?.easy_chords ?? []
  const tempo = bpm ?? song?.tempo_bpm
  return (
    <div className={cn('relative flex flex-wrap items-center gap-x-3 sm:gap-x-4', actionsHidden ? 'gap-y-0' : 'gap-y-2')} data-testid="song-header">
      <div className="relative size-12 shrink-0 overflow-hidden rounded-xl bg-charcoal-800 ring-1 ring-white/15 shadow-[0_14px_36px_rgba(0,0,0,0.5)] sm:size-14 lg:size-16">
        <img
          src={thumbnailSrc}
          alt=""
          className="h-full w-full object-cover"
          onError={onThumbnailError}
        />
      </div>

      <div className="min-w-0 flex-1">
        <h1 className="line-clamp-2 break-words text-left font-display text-[1.7rem] leading-[0.9] tracking-wide text-smoke-100 sm:line-clamp-1 sm:text-4xl lg:text-[2.6rem]" dir="auto">{title}</h1>
        <div className="mt-1 flex min-w-0 items-center gap-2">
          <p className="truncate text-left text-sm font-medium text-smoke-400 sm:text-base" dir="auto">{artist}</p>
          <button
            type="button"
            onClick={onToggleFavorite}
            className="-mx-0.5 grid size-7 shrink-0 place-items-center rounded-full text-fire-400 transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-flame-400/60"
            data-tour="favorite"
            data-testid={`favorite-toggle-${songId}`}
            aria-label={isFavorited ? 'Remove from favorites' : 'Add to favorites'}
            aria-pressed={isFavorited}
          >
            <Heart size={16} className={cn('transition-colors', isFavorited && 'fill-fire-400 animate-favorite-ignite')} aria-hidden="true" />
          </button>
          <SongFeedback songId={songId} />
          {isAdmin && <AdminMenu songId={songId} />}
          {song && shapes.length > 0 && (
            <p className="hidden min-w-0 items-center gap-2 truncate border-l border-white/10 pl-3 font-mono text-[11px] uppercase tracking-[0.12em] text-smoke-400 md:flex" data-testid="song-header-facts">
              {song.difficulty && <DifficultyBadge difficulty={song.difficulty} />}
              <span className="truncate text-sm normal-case tracking-normal text-flame-300" dir="ltr">{shapes.join(' · ')}</span>
              <span className="shrink-0">{song.easy_capo ? `Capo ${song.easy_capo}` : 'No capo'}</span>
              {tempo ? <span className="shrink-0">{Math.round(tempo)} bpm</span> : null}
            </p>
          )}
        </div>
      </div>

      {actions && (
        <Collapse open={!actionsHidden} className="order-last w-full min-w-0 lg:order-none lg:w-auto">
          <div className="-mx-1 flex min-w-0 overflow-x-auto scrollbar-hide lg:mx-0">
            {actions}
          </div>
        </Collapse>
      )}

      {/* Mobile-only: transport buttons live in the header row to save vertical space.
          No "start over" here: the title needs the room, and the seek bar goes back to 0:00. */}
      <div className="flex shrink-0 items-center gap-1.5 sm:hidden">
        <button
          type="button"
          onClick={() => onSeek(Math.max(0, usePlaybackStore.getState().currentTime - 10))}
          className={cn(
            'grid size-9 place-items-center rounded-full text-smoke-400 transition-colors',
            isPlaybackDisabled ? 'cursor-not-allowed opacity-50' : 'hover:bg-white/10 hover:text-smoke-100',
          )}
          aria-label="Back 10 seconds"
          data-testid="mobile-skip-back"
          disabled={isPlaybackDisabled}
        >
          <SkipBack size={21} />
        </button>
        <button
          type="button"
          onClick={onTogglePlay}
          className={cn(
            'flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-fire-400 to-fire-600 text-white shadow-[0_10px_28px_rgba(249,115,22,0.45)] transition-transform',
            isPlaying ? 'animate-flame-pulse' : '',
            isPlaybackDisabled ? 'cursor-not-allowed opacity-50' : 'active:scale-95',
          )}
          aria-label={isPlaying ? 'Pause' : 'Play'}
          data-testid="mobile-play-button"
          disabled={isPlaybackDisabled}
        >
          {isPlaying ? <Pause size={20} fill="currentColor" /> : <Play size={20} className="ml-0.5" fill="currentColor" />}
        </button>
        <button
          type="button"
          onClick={() => {
            const s = usePlaybackStore.getState()
            onSeek(Math.min(s.duration, s.currentTime + 10))
          }}
          className={cn(
            'grid size-9 place-items-center rounded-full text-smoke-400 transition-colors',
            isPlaybackDisabled ? 'cursor-not-allowed opacity-50' : 'hover:bg-white/10 hover:text-smoke-100',
          )}
          aria-label="Forward 10 seconds"
          data-testid="mobile-skip-forward"
          disabled={isPlaybackDisabled}
        >
          <SkipForward size={21} />
        </button>
      </div>
    </div>
  )
}

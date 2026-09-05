import { Pause, Play, RotateCcw, SkipBack, SkipForward } from 'lucide-react'
import { usePlaybackStore } from '@/stores/playback.store'
import { SongFeedback } from '../../components/SongFeedback'
import { AdminMenu } from './AdminMenu'
import { cn } from '@/lib/cn'

interface SongHeaderProps {
  songId: string
  title: string
  artist: string
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
  thumbnailSrc,
  isAdmin,
  isPlaying,
  isPlaybackDisabled = false,
  onTogglePlay,
  onSeek,
  onThumbnailError,
}: SongHeaderProps) {
  return (
    <div
      className="relative flex items-center gap-3 rounded-[1.35rem] border border-white/12 bg-[#121418]/92 p-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_18px_60px_rgba(0,0,0,0.42)] backdrop-blur-xl sm:gap-4 sm:p-3"
      data-testid="song-header"
    >
      <div className="relative size-12 shrink-0 overflow-hidden rounded-2xl bg-charcoal-800 ring-1 ring-white/15 shadow-[0_14px_36px_rgba(0,0,0,0.45)] sm:size-16 lg:size-20">
        <img
          src={thumbnailSrc}
          alt=""
          className="h-full w-full object-cover"
          onError={onThumbnailError}
        />
      </div>

      <div className="min-w-0 flex-1">
        <h1 className="truncate text-[1.35rem] font-black leading-none tracking-[-0.04em] text-smoke-100 sm:text-2xl lg:text-3xl">{title}</h1>
        <div className="mt-1 flex items-center gap-2">
          <p className="truncate text-sm font-medium text-smoke-400 sm:text-base">{artist}</p>
          <SongFeedback songId={songId} />
          {isAdmin && <AdminMenu songId={songId} />}
        </div>
      </div>

      {/* Mobile-only: transport buttons live in the header row to save vertical space */}
      <div className="flex shrink-0 items-center gap-1.5 sm:hidden">
        {isPlaying && (
          <button
            type="button"
            onClick={() => onSeek(0)}
            className={cn(
              'grid size-9 place-items-center rounded-full text-smoke-400 transition-colors',
              isPlaybackDisabled ? 'cursor-not-allowed opacity-50' : 'hover:bg-white/10 hover:text-smoke-100',
            )}
            aria-label="Start over"
            data-testid="mobile-player-restart"
            disabled={isPlaybackDisabled}
          >
            <RotateCcw size={21} aria-hidden="true" />
          </button>
        )}
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
            'flex h-12 w-12 items-center justify-center rounded-full bg-flame-400 text-charcoal-950 shadow-[0_10px_30px_rgba(250,204,21,0.28)] transition-colors',
            isPlaying ? 'animate-flame-pulse' : '',
            isPlaybackDisabled ? 'cursor-not-allowed opacity-50' : 'hover:bg-flame-500',
          )}
          aria-label={isPlaying ? 'Pause' : 'Play'}
          data-testid="mobile-play-button"
          disabled={isPlaybackDisabled}
        >
          {isPlaying ? <Pause size={20} /> : <Play size={20} className="ml-0.5" />}
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

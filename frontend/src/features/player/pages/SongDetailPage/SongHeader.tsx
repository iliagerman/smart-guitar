import { Pause, Play, SkipBack, SkipForward } from 'lucide-react'
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
    <div className="relative flex items-center gap-3 sm:gap-4" data-testid="song-header">
      <div className="relative size-12 sm:size-16 lg:size-20 shrink-0 rounded-xl overflow-hidden bg-charcoal-800 ring-1 ring-white/8 shadow-[0_10px_30px_rgba(0,0,0,0.35)]">
        <img
          src={thumbnailSrc}
          alt=""
          className="w-full h-full object-cover"
          onError={onThumbnailError}
        />
      </div>

      <div className="min-w-0 flex-1">
        <h1 className="text-xl sm:text-2xl font-bold leading-tight truncate">{title}</h1>
        <div className="flex items-center gap-2">
          <p className="text-smoke-400 text-sm sm:text-base truncate">{artist}</p>
          <SongFeedback songId={songId} />
          {isAdmin && <AdminMenu songId={songId} />}
        </div>
      </div>

      {/* Mobile-only: transport buttons live in the header row to save vertical space */}
      <div className="sm:hidden shrink-0 flex items-center gap-2">
        <button
          onClick={() => onSeek(Math.max(0, usePlaybackStore.getState().currentTime - 10))}
          className={cn(
            'text-smoke-400 transition-colors',
            isPlaybackDisabled ? 'cursor-not-allowed opacity-50' : 'hover:text-smoke-100',
          )}
          aria-label="Back 10 seconds"
          data-testid="mobile-skip-back"
          disabled={isPlaybackDisabled}
        >
          <SkipBack size={22} />
        </button>
        <button
          onClick={onTogglePlay}
          className={cn(
            'flex h-12 w-12 items-center justify-center rounded-full bg-flame-400 text-charcoal-950 transition-colors',
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
          onClick={() => {
            const s = usePlaybackStore.getState()
            onSeek(Math.min(s.duration, s.currentTime + 10))
          }}
          className={cn(
            'text-smoke-400 transition-colors',
            isPlaybackDisabled ? 'cursor-not-allowed opacity-50' : 'hover:text-smoke-100',
          )}
          aria-label="Forward 10 seconds"
          data-testid="mobile-skip-forward"
          disabled={isPlaybackDisabled}
        >
          <SkipForward size={22} />
        </button>
      </div>
    </div>
  )
}

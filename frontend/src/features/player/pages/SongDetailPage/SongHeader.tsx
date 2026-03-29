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
          className="text-smoke-400 hover:text-smoke-100 transition-colors"
          aria-label="Back 10 seconds"
          data-testid="mobile-skip-back"
        >
          <SkipBack size={22} />
        </button>
        <button
          onClick={onTogglePlay}
          className={cn(
            'w-12 h-12 rounded-full bg-flame-400 flex items-center justify-center text-charcoal-950 hover:bg-flame-500 transition-all',
            isPlaying ? 'animate-flame-pulse' : '',
          )}
          aria-label={isPlaying ? 'Pause' : 'Play'}
          data-testid="mobile-play-button"
        >
          {isPlaying ? <Pause size={20} /> : <Play size={20} className="ml-0.5" />}
        </button>
        <button
          onClick={() => {
            const s = usePlaybackStore.getState()
            onSeek(Math.min(s.duration, s.currentTime + 10))
          }}
          className="text-smoke-400 hover:text-smoke-100 transition-colors"
          aria-label="Forward 10 seconds"
          data-testid="mobile-skip-forward"
        >
          <SkipForward size={22} />
        </button>
      </div>
    </div>
  )
}

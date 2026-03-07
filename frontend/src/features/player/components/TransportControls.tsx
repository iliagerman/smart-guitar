import { Play, Pause, SkipBack, SkipForward } from 'lucide-react'
import { formatDuration } from '@/lib/format-duration'
import { usePlaybackStore } from '@/stores/playback.store'

interface TransportControlsProps {
  onTogglePlay: () => void
  onSeek: (time: number) => void
  selectors?: React.ReactNode
  /**
   * By default, hide play/skip buttons on mobile to free vertical space.
   * Use this if you want the full transport row on small screens.
   */
  showButtonsOnMobile?: boolean
}

export function TransportControls({
  onTogglePlay,
  onSeek,
  selectors,
  showButtonsOnMobile = false,
}: TransportControlsProps) {
  const { isPlaying, currentTime, duration } = usePlaybackStore()
  const progress = duration > 0 ? (currentTime / duration) * 100 : 0

  return (
    <div className="flex flex-col gap-2" data-testid="transport-controls">
      <div
        className="relative h-1.5 bg-charcoal-700 rounded-full cursor-pointer group"
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect()
          const ratio = (e.clientX - rect.left) / rect.width
          onSeek(ratio * duration)
        }}
      >
        <div
          className="absolute inset-y-0 left-0 bg-flame-400 rounded-full transition-all"
          style={{ width: `${progress}%` }}
        />
        <div
          className="absolute top-1/2 -translate-y-1/2 w-3 h-3 bg-flame-400 rounded-full shadow-[0_0_8px_rgba(250,204,21,0.5)] opacity-0 group-hover:opacity-100 transition-opacity"
          style={{ left: `${progress}%`, marginLeft: '-6px' }}
        />
      </div>
      <div className="flex items-center justify-between text-xs text-smoke-500 font-mono">
        <span>{formatDuration(currentTime)}<span className="text-smoke-600">.{String(Math.floor((currentTime % 1) * 1000)).padStart(3, '0')}</span></span>
        <span>{formatDuration(duration)}</span>
      </div>
      {selectors && (
        <div className="flex flex-wrap items-center gap-1 pt-1 min-w-0 lg:flex-nowrap lg:justify-center">
          {selectors}
        </div>
      )}

      <div className={showButtonsOnMobile ? 'flex items-center justify-center gap-6' : 'hidden sm:flex items-center justify-center gap-6'}>
        <button
          onClick={() => onSeek(Math.max(0, currentTime - 10))}
          className="text-smoke-400 hover:text-smoke-100 transition-colors"
          data-testid="player-skip-back"
        >
          <SkipBack size={24} />
        </button>
        <button
          onClick={onTogglePlay}
          className={`w-14 h-14 rounded-full bg-flame-400 flex items-center justify-center text-charcoal-950 hover:bg-flame-500 transition-all ${isPlaying ? 'animate-flame-pulse' : ''}`}
          data-testid="player-play-button"
        >
          {isPlaying ? <Pause size={24} /> : <Play size={24} className="ml-0.5" />}
        </button>
        <button
          onClick={() => onSeek(Math.min(duration, currentTime + 10))}
          className="text-smoke-400 hover:text-smoke-100 transition-colors"
          data-testid="player-skip-forward"
        >
          <SkipForward size={24} />
        </button>
      </div>
    </div>
  )
}

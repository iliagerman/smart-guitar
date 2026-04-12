import { useState } from 'react'
import { Play, Pause, SkipBack, SkipForward, Settings2, ChevronDown } from 'lucide-react'
import { formatDuration } from '@/lib/format-duration'
import { usePlaybackStore } from '@/stores/playback.store'
import { cn } from '@/lib/cn'

interface TransportControlsProps {
  onTogglePlay: () => void
  onSeek: (time: number) => void
  primaryControls?: React.ReactNode
  secondaryControls?: React.ReactNode
  isPlaybackDisabled?: boolean
  /**
   * By default, hide play/skip buttons on mobile to free vertical space.
   * Use this if you want the full transport row on small screens.
   */
  showButtonsOnMobile?: boolean
}

export function TransportControls({
  onTogglePlay,
  onSeek,
  primaryControls,
  secondaryControls,
  isPlaybackDisabled = false,
  showButtonsOnMobile = false,
}: TransportControlsProps) {
  const [showSecondary, setShowSecondary] = useState(false)
  const { isPlaying, currentTime, duration } = usePlaybackStore()
  const progress = duration > 0 ? (currentTime / duration) * 100 : 0

  return (
    <div className="flex flex-col gap-2" data-testid="transport-controls">
      <div
        className={cn(
          'relative h-1.5 rounded-full bg-charcoal-700 group',
          isPlaybackDisabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer',
        )}
        role="slider"
        aria-label="Playback progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(progress)}
        aria-disabled={isPlaybackDisabled}
        tabIndex={isPlaybackDisabled ? -1 : 0}
        data-testid="transport-progress-bar"
        onClick={(e) => {
          if (isPlaybackDisabled) return
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
      {/* Primary controls row */}
      {primaryControls && (
        <div className="flex items-center gap-2 justify-center pt-1 pb-3 overflow-x-auto scrollbar-hide">
          {primaryControls}
        </div>
      )}

      {/* Secondary controls row */}
      {secondaryControls && (
        <>
          <button
            className="sm:hidden flex items-center gap-1.5 text-smoke-400 hover:text-smoke-200 mx-auto py-1 transition-colors"
            onClick={() => setShowSecondary(!showSecondary)}
            aria-label="Toggle secondary controls"
            data-testid="transport-toggle-secondary"
          >
            <Settings2 size={20} />
            <ChevronDown size={16} className={cn('transition-transform', showSecondary && 'rotate-180')} />
          </button>
          <div className={cn(
            'flex flex-wrap items-center gap-1 justify-center border-t border-charcoal-700/40 pt-1.5 mt-0.5',
            'opacity-75 hover:opacity-100 transition-opacity',
            showSecondary ? 'flex' : 'hidden sm:flex',
          )}>
            {secondaryControls}
          </div>
        </>
      )}

      <div className={showButtonsOnMobile ? 'flex items-center justify-center gap-6' : 'hidden sm:flex items-center justify-center gap-6'}>
        <button
          onClick={() => onSeek(Math.max(0, currentTime - 10))}
          className={cn(
            'text-smoke-400 transition-colors',
            isPlaybackDisabled ? 'cursor-not-allowed opacity-50' : 'hover:text-smoke-100',
          )}
          aria-label="Back 10 seconds"
          data-testid="player-skip-back"
          disabled={isPlaybackDisabled}
        >
          <SkipBack size={24} />
        </button>
        <button
          onClick={onTogglePlay}
          className={cn(
            'flex h-14 w-14 items-center justify-center rounded-full bg-flame-400 text-charcoal-950 transition-colors',
            isPlaying && 'animate-flame-pulse',
            isPlaybackDisabled ? 'cursor-not-allowed opacity-50' : 'hover:bg-flame-500',
          )}
          aria-label={isPlaying ? 'Pause' : 'Play'}
          data-testid="player-play-button"
          disabled={isPlaybackDisabled}
        >
          {isPlaying ? <Pause size={24} /> : <Play size={24} className="ml-0.5" />}
        </button>
        <button
          onClick={() => onSeek(Math.min(duration, currentTime + 10))}
          className={cn(
            'text-smoke-400 transition-colors',
            isPlaybackDisabled ? 'cursor-not-allowed opacity-50' : 'hover:text-smoke-100',
          )}
          aria-label="Forward 10 seconds"
          data-testid="player-skip-forward"
          disabled={isPlaybackDisabled}
        >
          <SkipForward size={24} />
        </button>
      </div>
    </div>
  )
}

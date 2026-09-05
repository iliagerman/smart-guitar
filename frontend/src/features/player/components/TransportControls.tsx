import { useState } from 'react'
import { Play, Pause, RotateCcw, SkipBack, SkipForward, Settings2, ChevronDown } from 'lucide-react'
import { formatDuration } from '@/lib/format-duration'
import { usePlaybackStore } from '@/stores/playback.store'
import { cn } from '@/lib/cn'

interface TransportControlsProps {
  onTogglePlay: () => void
  onSeek: (time: number) => void
  primaryControls?: React.ReactNode
  pinnedControls?: React.ReactNode
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
  pinnedControls,
  secondaryControls,
  isPlaybackDisabled = false,
  showButtonsOnMobile = false,
}: TransportControlsProps) {
  const [showSecondary, setShowSecondary] = useState(false)
  // Only isPlaying drives this component (the play/pause icon). The seek bar and
  // clock — the only parts that change on every playback tick — live in
  // <PlaybackProgress>, so the transport buttons don't reconcile ~20x/sec during
  // playback. Skip handlers read the latest time/duration imperatively at click.
  const isPlaying = usePlaybackStore((s) => s.isPlaying)

  return (
    <div className="flex flex-col gap-2" data-testid="transport-controls">
      <PlaybackProgress onSeek={onSeek} isPlaybackDisabled={isPlaybackDisabled} />
      {/* Primary controls row */}
      {primaryControls && (
        <div className="grid w-full auto-cols-fr grid-flow-col gap-2 px-0.5 pb-2 pt-1">
          {primaryControls}
        </div>
      )}

      {/* Pinned controls row — always visible (mobile + desktop) */}
      {pinnedControls && (
        <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
          {pinnedControls}
        </div>
      )}

      {/* Secondary controls row */}
      {secondaryControls && (
        <>
          <button
            type="button"
            className="mx-auto flex items-center gap-1.5 rounded-full px-3 py-1 text-smoke-400 transition-colors hover:bg-white/10 hover:text-smoke-200 sm:hidden"
            onClick={() => setShowSecondary(!showSecondary)}
            aria-label="Toggle secondary controls"
            data-testid="transport-toggle-secondary"
          >
            <Settings2 size={20} />
            <ChevronDown size={16} className={cn('transition-transform', showSecondary && 'rotate-180')} />
          </button>
          <div
            className={cn(
              'mt-1 flex flex-wrap items-center justify-center gap-2 border-t border-white/10 pt-2',
              'opacity-80 transition-opacity hover:opacity-100',
              showSecondary ? 'flex' : 'hidden sm:flex',
            )}
            data-tour="secondary-controls"
          >
            {secondaryControls}
          </div>
        </>
      )}

      <div className={showButtonsOnMobile ? 'flex items-center justify-center gap-6' : 'hidden sm:flex items-center justify-center gap-6'}>
        {isPlaying && (
          <button
            type="button"
            onClick={() => onSeek(0)}
            className={cn(
              'text-smoke-400 transition-colors',
              isPlaybackDisabled ? 'cursor-not-allowed opacity-50' : 'hover:text-smoke-100',
            )}
            aria-label="Start over"
            data-testid="player-restart"
            disabled={isPlaybackDisabled}
          >
            <RotateCcw size={24} aria-hidden="true" />
          </button>
        )}
        <button
          type="button"
          onClick={() => onSeek(Math.max(0, usePlaybackStore.getState().currentTime - 10))}
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
          type="button"
          onClick={onTogglePlay}
          className={cn(
            'flex h-14 w-14 items-center justify-center rounded-full bg-flame-400 text-charcoal-950 shadow-[0_12px_32px_rgba(250,204,21,0.28)] transition-colors',
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
          type="button"
          onClick={() => {
            const { currentTime, duration } = usePlaybackStore.getState()
            onSeek(Math.min(duration, currentTime + 10))
          }}
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

interface PlaybackProgressProps {
  onSeek: (time: number) => void
  isPlaybackDisabled: boolean
}

/**
 * Seek bar + clock, isolated so the high-frequency currentTime subscription only
 * re-renders this leaf on each playback tick — not the whole transport bar.
 */
function PlaybackProgress({ onSeek, isPlaybackDisabled }: PlaybackProgressProps) {
  const currentTime = usePlaybackStore((s) => s.currentTime)
  const duration = usePlaybackStore((s) => s.duration)
  const loopStart = usePlaybackStore((s) => s.loopStart)
  const loopEnd = usePlaybackStore((s) => s.loopEnd)
  const progress = duration > 0 ? (currentTime / duration) * 100 : 0

  return (
    <>
      {/* Custom styled seek bar (gradient fill + hover thumb); a native <input type="range">
          can't reproduce this, so role="slider" with keyboard handling is intentional. */}
      {/* oxlint-disable-next-line react-doctor/prefer-tag-over-role */}
      <div role="slider"
        className={cn(
          'group relative h-2 rounded-full bg-white/10 shadow-inner',
          isPlaybackDisabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer',
        )}
        aria-label="Playback progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(progress)}
        aria-valuetext={`${formatDuration(currentTime)} of ${formatDuration(duration)}`}
        aria-disabled={isPlaybackDisabled}
        tabIndex={isPlaybackDisabled ? -1 : 0}
        data-testid="transport-progress-bar"
        onClick={(e) => {
          if (isPlaybackDisabled) return
          const rect = e.currentTarget.getBoundingClientRect()
          const ratio = (e.clientX - rect.left) / rect.width
          onSeek(ratio * duration)
        }}
        onKeyDown={(e) => {
          if (isPlaybackDisabled) return
          if (e.key === 'ArrowLeft') {
            e.preventDefault()
            onSeek(Math.max(0, currentTime - 5))
          } else if (e.key === 'ArrowRight') {
            e.preventDefault()
            onSeek(Math.min(duration, currentTime + 5))
          } else if (e.key === 'Home') {
            e.preventDefault()
            onSeek(0)
          } else if (e.key === 'End') {
            e.preventDefault()
            onSeek(duration)
          }
        }}
      >
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-flame-300 via-flame-400 to-fire-400 transition-[width]"
          style={{ width: `${progress}%` }}
        />
        <div
          className="absolute top-1/2 size-4 -translate-y-1/2 rounded-full bg-flame-300 opacity-0 shadow-[0_0_18px_rgba(250,204,21,0.7)] transition-opacity group-hover:opacity-100"
          style={{ left: `${progress}%`, marginLeft: '-8px' }}
        />
        {loopStart !== null && loopEnd !== null && duration > 0 && (
          <div
            className="absolute inset-y-0 bg-sky-400/25"
            style={{ left: `${(loopStart / duration) * 100}%`, width: `${((loopEnd - loopStart) / duration) * 100}%` }}
            data-testid="transport-loop-range"
          />
        )}
        {loopStart !== null && duration > 0 && (
          <div
            className="absolute inset-y-0 w-0.5 -translate-x-1/2 bg-sky-400"
            style={{ left: `${(loopStart / duration) * 100}%` }}
            data-testid="transport-loop-marker-a"
          />
        )}
        {loopEnd !== null && duration > 0 && (
          <div
            className="absolute inset-y-0 w-0.5 -translate-x-1/2 bg-sky-400"
            style={{ left: `${(loopEnd / duration) * 100}%` }}
            data-testid="transport-loop-marker-b"
          />
        )}
      </div>
      <div className="flex items-center justify-between px-1 font-mono text-xs text-smoke-500">
        <span>{formatDuration(currentTime)}<span className="text-smoke-600">.{String(Math.floor((currentTime % 1) * 1000)).padStart(3, '0')}</span></span>
        <span data-testid="transport-duration">{formatDuration(duration)}</span>
      </div>
    </>
  )
}

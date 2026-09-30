import { useState } from 'react'
import { Play, Pause, RotateCcw, SkipBack, SkipForward, Settings2, ChevronDown } from 'lucide-react'
import { formatDuration } from '@/lib/format-duration'
import { usePlaybackStore } from '@/stores/playback.store'
import { cn } from '@/lib/cn'
import { useMediaQuery } from '@/hooks/use-media-query'
import { dockPillClass } from '../lib/dock-button'

interface TransportControlsProps {
  onTogglePlay: () => void
  onSeek: (time: number) => void
  /** Right of the transport on larger screens (speed, loop, count-in); inside "More" on phones. */
  quickControls?: React.ReactNode
  /** Everything else, behind the "More" toggle. */
  secondaryControls?: React.ReactNode
  /** Playing on a phone: shown next to the seek bar instead of the "More" toggle and panel. */
  focusControls?: React.ReactNode
  isPlaybackDisabled?: boolean
}

/**
 * The player dock at the bottom of the song page: the seek bar, then one row
 * with the transport and the quick controls. On phones the transport lives in
 * the song header, so the dock keeps the bar and the settings.
 */
export function TransportControls({
  onTogglePlay,
  onSeek,
  quickControls,
  secondaryControls,
  focusControls,
  isPlaybackDisabled = false,
}: TransportControlsProps) {
  const [showMore, setShowMore] = useState(false)
  // Quick controls sit next to the transport on wide screens and inside "More"
  // on smaller ones — rendered once, wherever they belong.
  const quickInRow = useMediaQuery('(min-width: 1024px)')
  // Phones have the transport in the song header, so the settings toggle joins
  // the seek bar instead of taking a row of its own.
  const toggleInRow = useMediaQuery('(min-width: 640px)')
  // Only isPlaying drives this component (the play/pause icon). The seek bar and
  // clock — the only parts that change on every playback tick — live in
  // <PlaybackProgress>, so the transport buttons don't reconcile ~20x/sec during
  // playback. Skip handlers read the latest time/duration imperatively at click.
  const isPlaying = usePlaybackStore((s) => s.isPlaying)
  // Phones: "start over" sits by the seek bar once the song is under way.
  const underWay = usePlaybackStore((s) => s.isPlaying || s.currentTime > 0.5)
  const skipClass = cn(
    'grid size-10 place-items-center rounded-full text-smoke-300 transition-colors',
    isPlaybackDisabled ? 'cursor-not-allowed opacity-50' : 'hover:bg-white/[0.07] hover:text-smoke-100',
  )
  const hasMore = !focusControls && (!!secondaryControls || (!!quickControls && !quickInRow))
  const moreToggle = hasMore && (
    <button
      type="button"
      className={dockPillClass(showMore, 'max-sm:h-9 max-sm:px-3')}
      onClick={() => setShowMore(!showMore)}
      aria-expanded={showMore}
      aria-label="More player settings"
      data-testid="transport-toggle-secondary"
    >
      <Settings2 size={15} aria-hidden="true" />
      <span className="hidden sm:inline">More</span>
      <ChevronDown size={14} className={cn('transition-transform', !showMore && 'rotate-180')} aria-hidden="true" />
    </button>
  )

  return (
    <div className="flex flex-col gap-2" data-testid="transport-controls">
      <PlaybackProgress
        onSeek={onSeek}
        isPlaybackDisabled={isPlaybackDisabled}
        leading={!toggleInRow && underWay && (
          <button
            type="button"
            onClick={() => onSeek(0)}
            className={cn(skipClass, 'size-9 shrink-0 bg-white/[0.045]')}
            aria-label="Start over"
            title="Start over"
            data-testid="mobile-player-restart"
            disabled={isPlaybackDisabled}
          >
            <RotateCcw size={17} aria-hidden="true" />
          </button>
        )}
        trailing={focusControls ?? (toggleInRow ? null : moreToggle)}
      />

      <div className="hidden items-center justify-end gap-x-3 gap-y-2 sm:grid sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
        {/* Balances the right-hand controls so the transport stays centred. */}
        <div className="hidden sm:block" aria-hidden="true" />

        <div className="hidden items-center justify-center gap-2 sm:flex">
          {isPlaying && (
            <button
              type="button"
              onClick={() => onSeek(0)}
              className={skipClass}
              aria-label="Start over"
              data-testid="player-restart"
              disabled={isPlaybackDisabled}
            >
              <RotateCcw size={19} aria-hidden="true" />
            </button>
          )}
          <button
            type="button"
            onClick={() => onSeek(Math.max(0, usePlaybackStore.getState().currentTime - 10))}
            className={skipClass}
            aria-label="Back 10 seconds"
            data-testid="player-skip-back"
            disabled={isPlaybackDisabled}
          >
            <SkipBack size={20} />
          </button>
          <button
            type="button"
            onClick={onTogglePlay}
            className={cn(
              'grid size-14 place-items-center rounded-full bg-gradient-to-br from-fire-400 to-fire-600 text-white shadow-[0_10px_30px_rgba(249,115,22,0.45),inset_0_1px_0_rgba(255,255,255,0.3)] transition-transform',
              isPlaying && 'animate-flame-pulse',
              isPlaybackDisabled ? 'cursor-not-allowed opacity-50' : 'hover:scale-105',
            )}
            aria-label={isPlaying ? 'Pause' : 'Play'}
            data-testid="player-play-button"
            disabled={isPlaybackDisabled}
          >
            {isPlaying ? <Pause size={24} fill="currentColor" /> : <Play size={24} className="ml-0.5" fill="currentColor" />}
          </button>
          <button
            type="button"
            onClick={() => {
              const { currentTime, duration } = usePlaybackStore.getState()
              onSeek(Math.min(duration, currentTime + 10))
            }}
            className={skipClass}
            aria-label="Forward 10 seconds"
            data-testid="player-skip-forward"
            disabled={isPlaybackDisabled}
          >
            <SkipForward size={20} />
          </button>
        </div>

        <div className="flex min-w-0 shrink-0 items-center justify-end gap-1.5">
          {quickControls && quickInRow && <div className="flex items-center gap-1.5">{quickControls}</div>}
          {toggleInRow && moreToggle}
        </div>
      </div>

      {hasMore && (
        <div
          className={cn(
            'flex-wrap items-center justify-center gap-2 border-t border-white/10 pt-2.5',
            showMore ? 'flex' : 'hidden',
          )}
          data-tour="secondary-controls"
          data-testid="transport-more-panel"
        >
          {quickControls && !quickInRow && quickControls}
          {secondaryControls}
        </div>
      )}
    </div>
  )
}

interface PlaybackProgressProps {
  onSeek: (time: number) => void
  isPlaybackDisabled: boolean
  /** Before the clock ("start over" on phones). */
  leading?: React.ReactNode
  /** After the clock (the settings toggle on phones). */
  trailing?: React.ReactNode
}

/**
 * Seek bar + clock, isolated so the high-frequency currentTime subscription only
 * re-renders this leaf on each playback tick — not the whole transport bar.
 */
function PlaybackProgress({ onSeek, isPlaybackDisabled, leading, trailing }: PlaybackProgressProps) {
  const currentTime = usePlaybackStore((s) => s.currentTime)
  const duration = usePlaybackStore((s) => s.duration)
  const loopStart = usePlaybackStore((s) => s.loopStart)
  const loopEnd = usePlaybackStore((s) => s.loopEnd)
  const progress = duration > 0 ? (currentTime / duration) * 100 : 0

  return (
    <div className="flex items-center gap-2 sm:gap-3">
      {leading}
      <span className="w-9 shrink-0 text-right font-mono text-[11px] text-smoke-400 sm:w-[4.5rem]">
        {formatDuration(currentTime)}<span className="text-smoke-600 max-sm:hidden">.{String(Math.floor((currentTime % 1) * 1000)).padStart(3, '0')}</span>
      </span>
      {/* Custom styled seek bar (gradient fill + hover thumb); a native <input type="range">
          can't reproduce this, so role="slider" with keyboard handling is intentional. */}
      {/* oxlint-disable-next-line react-doctor/prefer-tag-over-role */}
      <div role="slider"
        className={cn(
          'group relative h-1.5 flex-1 rounded-full bg-white/10 shadow-inner transition-[height] hover:h-2',
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
          className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-flame-300 via-fire-400 to-fire-500 transition-[width]"
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
      <span className="w-10 shrink-0 font-mono text-[11px] text-smoke-400" data-testid="transport-duration">{formatDuration(duration)}</span>
      {trailing}
    </div>
  )
}

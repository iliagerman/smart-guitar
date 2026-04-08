import { Gauge } from 'lucide-react'

import { cn } from '@/lib/cn'
import { usePlaybackStore } from '@/stores/playback.store'
import { usePlayerPrefsStore } from '@/stores/player-prefs.store'

const SPEED_OPTIONS = [0.5, 0.75, 1, 1.25, 1.5] as const

function formatSpeed(rate: number) {
  return `${rate}x`
}

export function PlaybackSpeedSelector() {
  const playbackRate = usePlaybackStore((s) => s.playbackRate)
  const setPlaybackRate = usePlaybackStore((s) => s.setPlaybackRate)
  const currentSongId = usePlaybackStore((s) => s.currentSongId)
  const setSongOverride = usePlayerPrefsStore((s) => s.setSongOverride)

  function cycleNext() {
    const currentIdx = SPEED_OPTIONS.indexOf(playbackRate as (typeof SPEED_OPTIONS)[number])
    const nextIdx = (currentIdx + 1) % SPEED_OPTIONS.length
    const newRate = SPEED_OPTIONS[nextIdx]
    setPlaybackRate(newRate)
    if (currentSongId) {
      setSongOverride(currentSongId, 'playbackRate', newRate)
    }
  }

  return (
    <button
      type="button"
      className={cn(
        'inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium',
        'bg-charcoal-700 border border-charcoal-600 text-smoke-100',
        'hover:border-flame-400/30 transition-colors',
        'focus:outline-none focus:ring-2 focus:ring-flame-400/40 focus:ring-offset-1 focus:ring-offset-charcoal-800',
      )}
      onClick={cycleNext}
      title={`Speed: ${formatSpeed(playbackRate)}. Click to cycle.`}
      aria-label={`Playback speed: ${formatSpeed(playbackRate)}`}
      data-testid="playback-speed-selector"
    >
      <Gauge size={16} className="text-smoke-300" />
      <span>{formatSpeed(playbackRate)}</span>
    </button>
  )
}

import { cn } from '@/lib/cn'
import { usePlaybackStore } from '@/stores/playback.store'
import { beatIndexAt } from '@/features/metronome/lib/song-beat-grid'
import { holdLabel, type ChordBeats } from '../lib/chord-beats'

interface ChordHoldProps {
  beats: ChordBeats
  beatsPerBar: number
  beatTimes: readonly number[]
  /** The chord is sounding now: fill the pill as its beats pass. */
  live: boolean
  rtl: boolean
}

interface PillProps extends Omit<ChordHoldProps, 'live' | 'beatTimes'> {
  /** Beats of this chord already played, or -1. */
  played: number
}

function Pill({ beats, beatsPerBar, rtl, played }: PillProps) {
  const live = played >= 0
  return (
    <span
      className={cn(
        'pointer-events-none relative mt-1 inline-flex overflow-hidden rounded-full px-1.5 font-sans text-[11px] font-bold leading-4 transition-colors sm:text-xs',
        live ? 'bg-fire-500/20 text-flame-100 ring-1 ring-fire-400/50' : 'bg-white/[0.08] text-smoke-200',
      )}
      aria-hidden="true"
      data-testid="chord-hold"
      data-beats={beats.count}
    >
      {live && (
        <span
          className={cn('absolute inset-y-0 bg-fire-500/40 transition-[width] duration-150 ease-linear', rtl ? 'right-0' : 'left-0')}
          style={{ width: `${((played + 1) / beats.count) * 100}%` }}
        />
      )}
      <span className="relative whitespace-nowrap">{holdLabel(beats.count, beatsPerBar)}</span>
    </span>
  )
}

function LivePill({ beatTimes, ...props }: Omit<ChordHoldProps, 'live'>) {
  // Re-renders once per beat, and only for the chord that's sounding.
  const now = usePlaybackStore((s) => beatIndexAt(beatTimes, s.currentTime))
  return <Pill {...props} played={now === null ? -1 : Math.min(now - props.beats.first, props.beats.count - 1)} />
}

/**
 * How long to hold a chord — "½ bar", "1 bar", "2 bars" — in a pill under its
 * name. On the chord being played, the pill fills beat by beat.
 */
export function ChordHold({ live, beatTimes, ...props }: ChordHoldProps) {
  return live ? <LivePill beatTimes={beatTimes} {...props} /> : <Pill {...props} played={-1} />
}

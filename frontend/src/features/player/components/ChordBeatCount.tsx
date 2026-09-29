import { cn } from '@/lib/cn'
import { usePlaybackStore } from '@/stores/playback.store'
import { beatIndexAt } from '@/features/metronome/lib/song-beat-grid'
import { beatCount, type ChordBeats } from '../lib/chord-beats'

interface ChordBeatCountProps {
  beats: ChordBeats
  beatsPerBar: number
  beatTimes: readonly number[]
  /** The chord is sounding now: count its beats as they pass. */
  live: boolean
  rtl: boolean
}

interface CountProps extends Omit<ChordBeatCountProps, 'live' | 'beatTimes'> {
  /** Beats of this chord already played, or -1. */
  played: number
}

function Count({ beats, beatsPerBar, rtl, played }: CountProps) {
  const { counts, bars } = beatCount(beats, beatsPerBar)
  // A long hold shows one bar; its count follows the bar being played.
  const now = played < 0 ? -1 : bars ? played % beatsPerBar : played

  return (
    <span
      className={cn(
        'pointer-events-none mt-1 flex h-2.5 items-center gap-[3px] font-mono text-[9px] font-bold leading-none tabular-nums sm:text-[10px]',
        rtl && 'flex-row-reverse',
      )}
      aria-hidden="true"
      data-testid="chord-beat-count"
      data-beats={beats.count}
    >
      {counts.map((beat, i) => (
        <span
          // The count is positional and never reorders.
          // oxlint-disable-next-line react-doctor/no-array-index-key
          key={i}
          className={cn(
            'transition-colors duration-100',
            i === now
              ? 'text-flame-200 [text-shadow:0_0_8px_rgba(251,146,60,0.9)]'
              : i < now ? 'text-fire-400' : 'text-smoke-500',
          )}
        >
          {beat}
        </span>
      ))}
      {bars && <span className="ml-0.5 text-smoke-500">×{bars}</span>}
    </span>
  )
}

function LiveCount({ beatTimes, ...props }: Omit<ChordBeatCountProps, 'live'>) {
  // Re-renders once per beat, and only for the chord that's sounding.
  const now = usePlaybackStore((s) => beatIndexAt(beatTimes, s.currentTime))
  return <Count {...props} played={now === null ? -1 : Math.min(now - props.beats.first, props.beats.count - 1)} />
}

/**
 * How long to hold a chord, counted under its name the way a player counts
 * ("1 2 3 4", "1 2"), each number lighting up on its beat.
 */
export function ChordBeatCount({ live, beatTimes, ...props }: ChordBeatCountProps) {
  return live ? <LiveCount beatTimes={beatTimes} {...props} /> : <Count {...props} played={-1} />
}

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
  // Up to two bars read best as a beat count you can see at a glance; longer holds as text.
  const asBlocks = beats.count <= beatsPerBar * 2
  return (
    <span
      className={cn('pointer-events-none mt-1.5 inline-flex items-center', rtl && 'flex-row-reverse')}
      aria-hidden="true"
      data-testid="chord-hold"
      data-beats={beats.count}
    >
      {asBlocks ? (
        Array.from({ length: beats.count }, (_, beat) => (
          <span
            // Beats are positional and never reorder.
            // oxlint-disable-next-line react-doctor/no-array-index-key
            key={beat}
            data-played={beat <= played}
            className={cn(
              'h-2.5 w-3 rounded-[3px] transition-colors sm:h-3 sm:w-3.5',
              beat > 0 && (beat % beatsPerBar === 0 ? (rtl ? 'mr-2' : 'ml-2') : rtl ? 'mr-[3px]' : 'ml-[3px]'),
              // Live: played beats solid, the ones still to play hollow, so you can count what's left.
              beat <= played
                ? 'bg-flame-300 shadow-[0_0_6px_rgba(251,191,36,0.6)]'
                : live
                  ? 'bg-black/45 ring-[1.5px] ring-inset ring-smoke-100/80'
                  : 'bg-smoke-300/70',
            )}
          />
        ))
      ) : (
        <span
          className={cn(
            'relative overflow-hidden rounded-full px-2 font-sans text-[13px] font-bold leading-5',
            live ? 'bg-fire-500/25 text-flame-100 ring-1 ring-fire-400/60' : 'bg-white/15 text-smoke-100',
          )}
        >
          {live && (
            <span
              className={cn('absolute inset-y-0 bg-fire-500/40 transition-[width] duration-150 ease-linear', rtl ? 'right-0' : 'left-0')}
              style={{ width: `${((played + 1) / beats.count) * 100}%` }}
            />
          )}
          <span className="relative whitespace-nowrap">{holdLabel(beats.count, beatsPerBar)}</span>
        </span>
      )}
    </span>
  )
}

function LivePill({ beatTimes, ...props }: Omit<ChordHoldProps, 'live'>) {
  // Re-renders once per beat, and only for the chord that's sounding.
  const now = usePlaybackStore((s) => beatIndexAt(beatTimes, s.currentTime))
  return <Pill {...props} played={now === null ? -1 : Math.min(now - props.beats.first, props.beats.count - 1)} />
}

/**
 * How long to hold a chord, under its name: one block per beat (a gap between
 * bars) for up to two bars, "3 bars" and longer as text. On the chord being
 * played, the blocks light up beat by beat.
 */
export function ChordHold({ live, beatTimes, ...props }: ChordHoldProps) {
  return live ? <LivePill beatTimes={beatTimes} {...props} /> : <Pill {...props} played={-1} />
}

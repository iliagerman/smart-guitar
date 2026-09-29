import { useEffect, useMemo } from 'react'
import { Loader2, Play, Square } from 'lucide-react'

import { cn } from '@/lib/cn'
import { usePlaybackStore } from '@/stores/playback.store'
import type { SectionStrumPattern, StrumDirection } from '../lib/strum-pattern'
import {
  STRUM_SEARCH_MS,
  beatLabels,
  guessStepsPerBeat,
  mainPattern,
  starterPattern,
  strumStepAt,
} from '../lib/strum-display'
import { useBoundedLoading } from '../hooks/use-bounded-loading'
import { useStrumPlayback } from '../hooks/use-strum-playback'

const GLYPH: Record<StrumDirection, { symbol: string; className: string }> = {
  down: { symbol: '↓', className: 'text-emerald-400' },
  up: { symbol: '↑', className: 'text-amber-300' },
  chuck: { symbol: '×', className: 'text-rose-300' },
  miss: { symbol: '·', className: 'text-smoke-600' },
}

interface StrumStripProps {
  sectionPatterns: SectionStrumPattern[]
  bpm: number
  beatsPerBar?: number
  /** The song's beats (the first is a downbeat), for following the song. */
  beatTimes: readonly number[] | null
  loading?: boolean
}

/**
 * The strumming pattern on one line above the chord sheet, for screens without
 * the chord map beside it. While the song plays, the stroke being played lights
 * up; ▶ plays the pattern on its own.
 */
export function StrumStrip({ sectionPatterns, bpm, beatsPerBar = 4, beatTimes, loading = false }: StrumStripProps) {
  const searching = useBoundedLoading(loading && sectionPatterns.length === 0, STRUM_SEARCH_MS)

  if (searching) {
    return (
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-white/[0.06] bg-black/15 px-3 text-xs text-smoke-500" data-testid="strum-strip">
        <Loader2 size={13} className="animate-spin" aria-hidden="true" />
        Looking for the strumming pattern…
      </div>
    )
  }

  const section = mainPattern(sectionPatterns) ?? starterPattern(beatsPerBar)
  return (
    <StripPattern
      key={section.name}
      section={section}
      bpm={bpm}
      beatTimes={beatTimes}
      starter={sectionPatterns.length === 0}
    />
  )
}

interface StripPatternProps {
  section: SectionStrumPattern
  bpm: number
  beatTimes: readonly number[] | null
  starter: boolean
}

function StripPattern({ section, bpm, beatTimes, starter }: StripPatternProps) {
  const directions = useMemo(() => section.pattern.map((step) => step.direction), [section.pattern])
  const stepsPerBeat = section.stepsPerBeat ?? guessStepsPerBeat(directions.length)
  const labels = beatLabels(directions.length, stepsPerBeat)
  const { isPlaying: previewing, currentBeatIndex, toggle } = useStrumPlayback(directions, bpm, stepsPerBeat, section.accents)

  const songPlaying = usePlaybackStore((s) => s.isPlaying)
  // Re-renders once per stroke, not on every playback tick.
  const songStep = usePlaybackStore((s) =>
    s.isPlaying && beatTimes ? strumStepAt(beatTimes, s.currentTime, directions.length, stepsPerBeat) : -1,
  )
  const lit = previewing ? currentBeatIndex : songStep

  // The song and the preview never strum over each other.
  useEffect(() => {
    if (songPlaying && previewing) toggle()
  }, [songPlaying, previewing, toggle])

  return (
    <div
      className="flex h-11 shrink-0 items-center gap-2.5 border-b border-white/[0.06] bg-black/15 pl-3 pr-2"
      data-testid="strum-strip"
      data-starter={starter}
    >
      <div className="flex w-12 shrink-0 flex-col gap-1 leading-none">
        <span className="font-mono text-[9px] font-semibold uppercase tracking-[0.2em] text-fire-300">Strum</span>
        <span className="truncate text-[9px] font-semibold text-smoke-500" title={section.name}>
          {starter ? 'starter' : section.name}
        </span>
      </div>
      <ol
        className="flex min-w-0 flex-1 items-end gap-0.5 overflow-x-auto scrollbar-hide"
        aria-label={`Strumming pattern: ${section.pattern.map((step) => step.title).join(', ')}`}
      >
        {section.pattern.map((step, index) => {
          const glyph = GLYPH[step.direction]
          const label = labels[index] ?? ''
          const on = index === lit
          return (
            // Steps are positional and never reorder.
            // oxlint-disable-next-line react-doctor/no-array-index-key
            <li key={index}
              className={cn(
                'flex min-w-[1.15rem] flex-col items-center rounded-md px-0.5 pt-0.5 transition-[background-color,transform] duration-100 motion-reduce:transition-none',
                on && 'scale-110 bg-flame-400/20',
              )}
              data-testid="strum-strip-step"
              data-direction={step.direction}
              data-on={on}
            >
              <span className={cn('text-base font-bold leading-none', glyph.className, step.direction !== 'miss' && !on && 'opacity-80')} aria-hidden="true">
                {glyph.symbol}
              </span>
              <span
                className={cn(
                  'mt-0.5 font-mono text-[8px] leading-none',
                  on ? 'text-flame-300' : /^\d+$/.test(label) ? 'text-smoke-400' : 'text-smoke-600',
                )}
                aria-hidden="true"
              >
                {label}
              </span>
            </li>
          )
        })}
      </ol>
      <button
        type="button"
        onClick={toggle}
        disabled={songPlaying}
        className={cn(
          'grid size-8 shrink-0 place-items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-flame-400/60',
          previewing ? 'bg-flame-400/30 text-flame-200' : 'bg-fire-500/15 text-fire-200 enabled:hover:bg-fire-500/25',
          'disabled:opacity-35',
        )}
        aria-label={previewing ? 'Stop the strumming pattern' : 'Hear the strumming pattern'}
        title={songPlaying ? 'Follows the song while it plays' : undefined}
        data-testid="strum-strip-play"
      >
        {previewing ? <Square size={11} aria-hidden="true" /> : <Play size={11} className="ml-0.5" aria-hidden="true" />}
      </button>
    </div>
  )
}

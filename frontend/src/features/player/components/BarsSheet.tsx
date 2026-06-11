import { useEffect, useMemo, useRef } from 'react'

import { formatChordWithBass, getChordColor } from '@/lib/chord-colors'
import { usePlaybackStore } from '@/stores/playback.store'
import { usePlayerPrefsStore } from '@/stores/player-prefs.store'
import type { ChordEntry } from '@/types/song'

import { findActiveTimedIndex } from '../lib/active-timed-index'
import { groupChordsIntoBars, type Bar } from '../lib/bars'

interface BarsSheetProps {
  chords: ChordEntry[]
  barStarts: number[]
  duration: number
  bpm?: number | null
  onSeek?: (time: number) => void
}

/**
 * Measures (bars) view of the chord timeline: the song laid out as a grid of
 * bars the way a player reads a chart, with the active bar following
 * playback. Chord names respect the active display transform (capo/easy)
 * because callers pass the already-transformed chord list.
 */
export function BarsSheet({ chords, barStarts, duration, bpm, onSeek }: BarsSheetProps) {
  const currentTime = usePlaybackStore((s) => s.currentTime)
  const showBass = usePlayerPrefsStore((s) => s.showBassNotes)
  const scrollRef = useRef<HTMLDivElement>(null)
  const activeBarRef = useRef<HTMLButtonElement>(null)

  const bars = useMemo(
    () => groupChordsIntoBars(chords, barStarts, duration),
    [chords, barStarts, duration],
  )

  const activeBarIndex = findActiveTimedIndex(
    bars.length,
    currentTime,
    (i) => bars[i].start,
    (i) => bars[i].end,
  )

  useEffect(() => {
    const el = activeBarRef.current
    const container = scrollRef.current
    if (!el || !container) return
    const elTop = el.offsetTop
    const visibleTop = container.scrollTop
    const visibleBottom = visibleTop + container.clientHeight
    if (elTop < visibleTop + 40 || elTop > visibleBottom - 80) {
      container.scrollTo({ top: elTop - container.clientHeight / 3, behavior: 'smooth' })
    }
  }, [activeBarIndex])

  if (bars.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-smoke-500" data-testid="bars-sheet-empty">
        No bar grid detected for this song yet.
      </div>
    )
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col" data-testid="bars-sheet">
      {bpm ? (
        <div className="pb-2 text-xs text-smoke-500">{Math.round(bpm)} BPM · 4/4</div>
      ) : null}
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto pr-1">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {bars.map((bar, i) => (
            <BarCell
              key={bar.start}
              bar={bar}
              index={i}
              isActive={i === activeBarIndex}
              showBass={showBass}
              onSeek={onSeek}
              activeRef={i === activeBarIndex ? activeBarRef : undefined}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

interface BarCellProps {
  bar: Bar
  index: number
  isActive: boolean
  showBass: boolean
  onSeek?: (time: number) => void
  activeRef?: React.Ref<HTMLButtonElement>
}

function BarCell({ bar, index, isActive, showBass, onSeek, activeRef }: BarCellProps) {
  // Collapse repeated holds of the same chord within the bar for readability.
  const names: string[] = []
  for (const c of bar.chords) {
    const label = formatChordWithBass(c.chord, c.bass, showBass)
    if (names[names.length - 1] !== label) names.push(label)
  }

  return (
    <button
      ref={activeRef}
      type="button"
      onClick={() => onSeek?.(bar.start)}
      aria-label={`Bar ${index + 1}${names.length ? `: ${names.join(', ')}` : ''}`}
      className={
        'relative min-h-14 rounded-md border px-2 py-1.5 text-left transition-colors ' +
        (isActive
          ? 'border-flame-400 bg-flame-400/10'
          : 'border-charcoal-600 bg-charcoal-800 hover:border-charcoal-500')
      }
      data-testid={`bars-sheet-bar-${index}`}
    >
      <span className="absolute right-1.5 top-1 text-[10px] tabular-nums text-smoke-600">{index + 1}</span>
      <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 pt-2.5">
        {names.length === 0 ? (
          <span className="text-xs text-smoke-600">·</span>
        ) : (
          names.map((name, j) => (
            <span
              key={`${name}-${j}`}
              className="text-sm font-semibold"
              style={{ color: getChordColor(name, 'dark') }}
            >
              {name}
            </span>
          ))
        )}
      </span>
    </button>
  )
}

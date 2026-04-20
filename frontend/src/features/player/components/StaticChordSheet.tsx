import { useRef, useEffect } from 'react'

import { cn } from '@/lib/cn'
import { getChordColor, formatChordName } from '@/lib/chord-colors'
import { transposeChordLabel } from '@/lib/chord-utils'
import { usePlaybackStore } from '@/stores/playback.store'
import { usePlayerPrefsStore } from '@/stores/player-prefs.store'
import type { StaticChordLine, StaticChordPosition } from '@/types/song'

import { useAutoScroll } from '../hooks/use-auto-scroll'

interface StaticChordSheetProps {
  lines: StaticChordLine[]
}

/**
 * Renders a static chord sheet (from Ultimate Guitar) as monospace text.
 * Chords are positioned above lyrics at the correct character offsets.
 * Supports auto-scroll and transpose.
 */
export function StaticChordSheet({ lines }: StaticChordSheetProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const currentSongId = usePlaybackStore((s) => s.currentSongId)
  const transposeSemitones = usePlayerPrefsStore((s) => s.transposeSemitones)

  useAutoScroll(scrollRef, true)

  // Reset scroll to top when song changes
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = 0
    }
  }, [currentSongId])

  if (lines.length === 0) return null

  return (
    <div
      ref={scrollRef}
      className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden scrollbar-hide font-mono text-lg md:text-xl rounded-xl p-4 bg-charcoal-900/40"
      data-testid="static-chord-sheet"
    >
      {lines.map((line, i) => (
        <StaticLine
          key={i}
          line={line}
          transposeSemitones={transposeSemitones}
        />
      ))}
    </div>
  )
}

interface StaticLineProps {
  line: StaticChordLine
  transposeSemitones: number
}

function StaticLine({ line, transposeSemitones }: StaticLineProps) {
  if (line.type === 'empty') {
    return <div className="h-4" />
  }

  if (line.type === 'section') {
    return (
      <div className="mt-6 mb-2 text-flame-400 font-bold text-sm uppercase tracking-wider">
        [{line.text}]
      </div>
    )
  }

  if (line.type === 'instrumental') {
    return (
      <div className="my-1">
        <ChordRow
          chords={line.chords}
          lineLength={0}
          transposeSemitones={transposeSemitones}
        />
      </div>
    )
  }

  // type === 'lyric'
  const hasChords = line.chords.length > 0

  return (
    <div className="my-0.5">
      {hasChords && (
        <ChordRow
          chords={line.chords}
          lineLength={line.text.length}
          transposeSemitones={transposeSemitones}
        />
      )}
      <div className="whitespace-pre-wrap text-smoke-300 leading-relaxed">
        {line.text}
      </div>
    </div>
  )
}

interface ChordRowProps {
  chords: StaticChordPosition[]
  lineLength: number
  transposeSemitones: number
}

/**
 * Renders a row of chord names positioned at their character offsets.
 * Uses a single pre-formatted line with colored chord spans.
 */
function ChordRow({ chords, lineLength, transposeSemitones }: ChordRowProps) {
  if (chords.length === 0) return null

  // Build segments: gaps (spaces) and chords, in order of position
  const sorted = [...chords].sort((a, b) => a.position - b.position)
  const segments: { type: 'gap' | 'chord'; text: string; chord?: string }[] = []
  let cursor = 0

  for (const { chord, position } of sorted) {
    const transposed = transposeSemitones !== 0
      ? transposeChordLabel(chord, transposeSemitones)
      : chord
    const formatted = formatChordName(transposed)

    if (position > cursor) {
      segments.push({ type: 'gap', text: ' '.repeat(position - cursor) })
    }
    segments.push({ type: 'chord', text: formatted, chord: transposed })
    cursor = position + formatted.length
  }

  // Pad to at least the lyrics line length
  if (cursor < lineLength) {
    segments.push({ type: 'gap', text: ' '.repeat(lineLength - cursor) })
  }

  return (
    <div className="whitespace-pre leading-relaxed">
      {segments.map((seg, i) =>
        seg.type === 'chord' ? (
          <span
            key={i}
            className={cn(getChordColor(seg.chord!, 'dark'), 'font-bold')}
          >
            {seg.text}
          </span>
        ) : (
          <span key={i}>{seg.text}</span>
        ),
      )}
    </div>
  )
}

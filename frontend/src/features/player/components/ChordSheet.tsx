import { useRef, useEffect, useMemo, useCallback } from 'react'
import { mergeChordLyrics } from '../lib/merge-chords-lyrics'
import { getStrumPattern, type StrumSymbol } from '../lib/strum-pattern'
import { useChordSheetSync } from '../hooks/use-chord-sheet-sync'
import { useAutoScroll } from '../hooks/use-auto-scroll'
import { getChordColor, formatChordName } from '@/lib/chord-colors'
import { cn } from '@/lib/cn'
import { usePlayerPrefsStore } from '@/stores/player-prefs.store'
import type { ChordEntry, LyricsSegment, RhythmInfo, StrumEvent } from '@/types/song'

interface ChordSheetProps {
  chords: ChordEntry[]
  lyrics: LyricsSegment[]
  strums: StrumEvent[]
  rhythm?: RhythmInfo | null
  onSeek?: (time: number) => void
}

function StrumArrows({ pattern }: { pattern: StrumSymbol[] }) {
  if (pattern.length === 0) return null
  return (
    <span className="text-xs tracking-wider leading-none">
      {pattern.map((s, i) => (
        <span key={i} className={cn(s.className, 'font-bold')} title={s.title}>
          {s.symbol}
        </span>
      ))}
    </span>
  )
}

function ChordWithPattern({
  chord,
  isActive,
  strumPattern,
  onClick,
}: {
  chord: { chord: string; start_time: number; end_time: number }
  isActive: boolean
  strumPattern: StrumSymbol[]
  onClick: () => void
}) {
  return (
    <span
      className={cn(
        'inline-flex flex-col items-center cursor-pointer hover:opacity-80',
        isActive && 'chord-sheet-chord-active'
      )}
      onClick={onClick}
      role="button"
      tabIndex={0}
      aria-current={isActive ? 'true' : undefined}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onClick()
        }
      }}
    >
      <span className={cn(getChordColor(chord.chord, 'dark'), 'font-bold text-lg md:text-xl')}>
        {formatChordName(chord.chord)}
      </span>
      <StrumArrows pattern={strumPattern} />
    </span>
  )
}

export function ChordSheet({ chords, lyrics, strums, rhythm, onSeek }: ChordSheetProps) {
  const rhythmInfo = rhythm ?? null
  const showStrums = usePlayerPrefsStore((s) => s.showStrums)
  const showHighlight = usePlayerPrefsStore((s) => s.lyricsMode !== 'none')
  const lines = useMemo(
    () => mergeChordLyrics(chords, lyrics),
    [chords, lyrics]
  )
  const { activeLineIndex, activeWordIndex, activeChordIndex } = useChordSheetSync(lines)
  const scrollRef = useRef<HTMLDivElement>(null)
  const activeLineRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (showHighlight && activeLineRef.current && scrollRef.current) {
      activeLineRef.current.scrollIntoView({
        behavior: 'auto',
        block: 'center',
      })
    }
  }, [activeLineIndex, showHighlight])

  useAutoScroll(scrollRef, !showHighlight)

  const handleChordClick = useCallback(
    (time: number) => {
      onSeek?.(time)
    },
    [onSeek]
  )

  const handleWordClick = useCallback(
    (time: number) => {
      onSeek?.(time)
    },
    [onSeek]
  )

  if (lines.length === 0) return null

  return (
    <div
      ref={scrollRef}
      className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden wrap-break-word scrollbar-hide font-mono text-lg md:text-xl bg-charcoal-900/40 text-smoke-300 rounded-xl p-4"
      data-testid="chord-sheet"
    >
      {lines.map((line, li) => {
        const isActive = li === activeLineIndex
        const isInstrumental = line.segmentIndex === -1
        const isRtl = line.direction === 'rtl'

        return (
          <div
            key={li}
            ref={isActive ? activeLineRef : undefined}
            className={cn(
              'px-3 py-1 rounded-sm',
              isInstrumental && 'mt-4 mb-2',
              isActive && showHighlight && 'chord-sheet-line-active',
              isRtl ? 'chord-sheet-rtl text-right' : 'chord-sheet-ltr text-left'
            )}
            dir={line.direction}
          >
            {isInstrumental ? (
              <div className="flex flex-wrap gap-x-4 gap-y-2">
                <span className="text-smoke-500 italic text-xs w-full">
                  [Instrumental]
                </span>
                {line.chords.map((chord, ci) => {
                  const isChordActive = isActive && showHighlight && ci === activeChordIndex
                  const pattern = showStrums ? getStrumPattern(chord.start_time, chord.end_time, strums, { rhythm: rhythmInfo }) : []
                  return (
                    <ChordWithPattern
                      key={ci}
                      chord={chord}
                      isActive={isChordActive}
                      strumPattern={pattern}
                      onClick={() => handleChordClick(chord.start_time)}
                    />
                  )
                })}
              </div>
            ) : (
              <div className={cn('leading-normal', (!isActive || !showHighlight) && 'text-smoke-500')}>
                {line.words.length > 0 ? (
                  (() => {
                    let currentOffset = 0;
                    return line.words.map((word, wi) => {
                      const isActiveWord = isActive && showHighlight && wi === activeWordIndex
                      const nextOffset = currentOffset + word.word.length + 1;
                      const isLastWord = wi === line.words.length - 1;
                      const wordChords = line.chords.filter(c =>
                        c.charOffset >= currentOffset &&
                        (isLastWord ? true : c.charOffset < nextOffset)
                      );
                      currentOffset = nextOffset;

                      return (
                        <div key={wi} className="inline-flex flex-col align-bottom mr-1">
                          {/* Chord + strum pattern row */}
                          <div className="min-h-6 flex gap-1">
                            {wordChords.map((chord, ci) => {
                              const globalCi = line.chords.indexOf(chord)
                              const isChordActive = isActive && showHighlight && globalCi === activeChordIndex
                              const pattern = showStrums ? getStrumPattern(chord.start_time, chord.end_time, strums, { rhythm: rhythmInfo }) : []
                              return (
                                <ChordWithPattern
                                  key={ci}
                                  chord={chord}
                                  isActive={isChordActive}
                                  strumPattern={pattern}
                                  onClick={() => handleChordClick(chord.start_time)}
                                />
                              )
                            })}
                          </div>
                          {/* Word */}
                          <span
                            className={cn(
                              'cursor-pointer rounded px-0.5',
                              isActiveWord
                                ? 'bg-flame-400 text-charcoal-950 font-semibold'
                                : isActive
                                  ? 'text-smoke-100'
                                  : 'hover:text-smoke-300'
                            )}
                            onClick={() => handleWordClick(word.start)}
                            title={`${word.start.toFixed(2)}s – ${word.end.toFixed(2)}s`}
                          >
                            {word.word}
                          </span>
                        </div>
                      )
                    })
                  })()
                ) : (
                  <div className="flex flex-col">
                    <div className="min-h-6 flex gap-2">
                      {line.chords.map((chord, ci) => {
                        const isChordActive = isActive && showHighlight && ci === activeChordIndex
                        const pattern = showStrums ? getStrumPattern(chord.start_time, chord.end_time, strums, { rhythm: rhythmInfo }) : []
                        return (
                          <ChordWithPattern
                            key={ci}
                            chord={chord}
                            isActive={isChordActive}
                            strumPattern={pattern}
                            onClick={() => handleChordClick(chord.start_time)}
                          />
                        )
                      })}
                    </div>
                    <span
                      className={cn(
                        'cursor-pointer',
                        isActive && showHighlight ? 'text-smoke-100' : ''
                      )}
                      onClick={() => handleWordClick(line.startTime)}
                    >
                      {line.text}
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

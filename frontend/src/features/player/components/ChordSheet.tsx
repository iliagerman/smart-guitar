import { useRef, useEffect, useMemo, useCallback } from 'react'
import { mergeChordLyrics } from '../lib/merge-chords-lyrics'
import { useChordSheetSync } from '../hooks/use-chord-sheet-sync'
import { useAutoScroll } from '../hooks/use-auto-scroll'
import { scrollToCenter } from '../lib/scroll-to-center'
import { getChordColor, formatChordName } from '@/lib/chord-colors'
import { cn } from '@/lib/cn'
import { usePlayerPrefsStore } from '@/stores/player-prefs.store'
import type { ChordEntry, LyricsSegment } from '@/types/song'

interface ChordSheetProps {
  chords: ChordEntry[]
  lyrics: LyricsSegment[]
  onSeek?: (time: number) => void
}

function estimateChordLabelWidth(chordName: string) {
  return formatChordName(chordName).length + 1
}


function ChordLabel({
  chord,
  isActive,
  isRtl,
  onClick,
}: {
  chord: { chord: string; start_time: number; end_time: number }
  isActive: boolean
  isRtl: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      dir="ltr"
      className={cn(
        'inline-flex min-w-0 rounded-md px-1 py-0.5 transition-colors hover:bg-charcoal-950/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-flame-400/70 whitespace-nowrap',
        isRtl ? 'justify-end text-right' : 'justify-start text-left',
        isActive && 'chord-sheet-chord-active'
      )}
      style={{ unicodeBidi: 'isolate' }}
      onClick={onClick}
      aria-current={isActive ? 'true' : undefined}
    >
      <span
        dir="ltr"
        className={cn(getChordColor(chord.chord, 'dark'), 'font-bold text-lg md:text-xl leading-none')}
        style={{ unicodeBidi: 'isolate' }}
      >
        {formatChordName(chord.chord)}
      </span>
    </button>
  )
}

export function ChordSheet({ chords, lyrics, onSeek }: ChordSheetProps) {
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
      scrollToCenter(scrollRef.current, activeLineRef.current)
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
              <div className="flex flex-wrap gap-x-5 gap-y-3">
                <span className="text-smoke-500 italic text-xs w-full">
                  [Instrumental]
                </span>
                {line.chords.map((chord, ci) => {
                  const isChordActive = isActive && showHighlight && ci === activeChordIndex
                  return (
                    <ChordLabel
                      key={ci}
                      chord={chord}
                      isActive={isChordActive}
                      isRtl={false}
                      onClick={() => handleChordClick(chord.start_time)}
                    />
                  )
                })}
              </div>
            ) : (
              <div className={cn('leading-normal', (!isActive || !showHighlight) && 'text-smoke-500')}>
                {line.words.length > 0 ? (
                  (() => {
                    let currentOffset = 0
                    return line.words.map((word, wi) => {
                      const isActiveWord = isActive && showHighlight && wi === activeWordIndex
                      const nextOffset = currentOffset + word.word.length + 1
                      const isLastWord = wi === line.words.length - 1
                      const wordChords = line.chords.filter((chord) =>
                        chord.charOffset >= currentOffset &&
                        (isLastWord ? true : chord.charOffset < nextOffset)
                      )
                      const reservedWidthCh = Math.max(
                        word.word.length + 1,
                        wordChords.reduce((total, chord) => total + estimateChordLabelWidth(chord.chord), 0)
                      )
                      currentOffset = nextOffset

                      return (
                        <div
                          key={wi}
                          className="inline-flex flex-col align-top gap-1 px-1 pb-1"
                          style={{ minWidth: `${reservedWidthCh}ch` }}
                        >
                          <div className={cn('min-h-7 flex flex-wrap gap-1', isRtl ? 'justify-end' : 'justify-start')}>
                            {wordChords.map((chord, ci) => {
                              const globalCi = line.chords.indexOf(chord)
                              const isChordActive = isActive && showHighlight && globalCi === activeChordIndex
                              return (
                                <ChordLabel
                                  key={ci}
                                  chord={chord}
                                  isActive={isChordActive}
                                  isRtl={isRtl}
                                  onClick={() => handleChordClick(chord.start_time)}
                                />
                              )
                            })}
                          </div>

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
                    <div className="min-h-8 flex flex-wrap items-end gap-2">
                      {line.chords.map((chord, ci) => {
                        const isChordActive = isActive && showHighlight && ci === activeChordIndex
                        return (
                          <ChordLabel
                            key={ci}
                            chord={chord}
                            isActive={isChordActive}
                            isRtl={isRtl}
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

import { useRef, useEffect, useMemo, useCallback } from 'react'

import { mergeTabsLyrics, type PositionedTabNote } from '../lib/merge-tabs-lyrics'
import { buildGridSlots, chooseSubdivision, quantizeStrumsToSlots, type GridMode } from '../lib/strum-grid'
import { useTabsSheetSync } from '../hooks/use-tabs-sheet-sync'
import { useAutoScroll } from '../hooks/use-auto-scroll'
import { cn } from '@/lib/cn'
import { usePlayerPrefsStore } from '@/stores/player-prefs.store'
import type { LyricsSegment, RhythmInfo, StrumEvent, TabNote } from '@/types/song'

interface TabsSheetProps {
  tabs: TabNote[]
  lyrics: LyricsSegment[]
  strums: StrumEvent[]
  rhythm: RhythmInfo | null
  onSeek?: (time: number) => void
}

const STRING_LABELS_BY_INDEX = ['E', 'A', 'D', 'G', 'B', 'e'] as const
const STRING_DISPLAY_ORDER = [5, 4, 3, 2, 1, 0] as const

function clampStringIndex(i: number) {
  if (Number.isNaN(i)) return 0
  return Math.min(5, Math.max(0, i))
}

function estimateLineWidth(text: string, wordsCount: number) {
  const min = 28
  const extraForSpaces = Math.max(0, wordsCount - 1)
  return Math.max(min, text.length + extraForSpaces)
}

const LABEL_PREFIX_WIDTH = 2 // "E|"

/**
 * Compute time-based note offsets with collision avoidance.
 * Returns a Map of note → character offset (includes label prefix)
 * and the staff width needed to fit all notes.
 */
function layoutLineNotes(
  notes: PositionedTabNote[],
  startTime: number,
  endTime: number,
  baseWidth: number
): { noteOffsets: Map<PositionedTabNote, number>; staffWidth: number } {
  const duration = Math.max(0.001, endTime - startTime)

  // Group notes into time buckets (e.g., within 50ms of each other)
  // First, sort all notes by start_time
  const sortedNotes = [...notes].sort((a, b) => a.start_time - b.start_time)

  const timeBuckets: PositionedTabNote[][] = []
  for (const note of sortedNotes) {
    if (timeBuckets.length === 0) {
      timeBuckets.push([note])
    } else {
      const lastBucket = timeBuckets[timeBuckets.length - 1]
      const bucketTime = lastBucket[0].start_time
      if (Math.abs(note.start_time - bucketTime) < 0.05) {
        lastBucket.push(note)
      } else {
        timeBuckets.push([note])
      }
    }
  }

  // Calculate the maximum width needed for each bucket
  // A bucket's width is the max length of fret strings in that bucket + 1 (for spacing)
  const bucketWidths = timeBuckets.map(bucket => {
    const maxFretLength = Math.max(...bucket.map(n => String(n.fret).length))
    return maxFretLength + 1
  })

  const minNoteWidth = bucketWidths.reduce((sum, w) => sum + w, 0)
  const effectiveWidth = Math.max(baseWidth, minNoteWidth)

  const noteOffsets = new Map<PositionedTabNote, number>()
  let neededWidth = effectiveWidth

  // Assign offsets to buckets
  const bucketOffsets: number[] = []
  for (let i = 0; i < timeBuckets.length; i++) {
    const bucket = timeBuckets[i]
    const bucketTime = bucket[0].start_time
    const ratio = (bucketTime - startTime) / duration
    let offset = Math.round(ratio * (effectiveWidth - 1))

    // Collision avoidance with previous bucket
    if (i > 0) {
      const minPos = bucketOffsets[i - 1] + bucketWidths[i - 1]
      if (offset < minPos) {
        offset = minPos
      }
    }
    bucketOffsets.push(offset)

    // Assign this offset to all notes in the bucket
    for (const note of bucket) {
      noteOffsets.set(note, LABEL_PREFIX_WIDTH + offset)
    }
  }

  if (timeBuckets.length > 0) {
    const lastIdx = timeBuckets.length - 1
    const endPos = bucketOffsets[lastIdx] + bucketWidths[lastIdx]
    neededWidth = Math.max(neededWidth, endPos)
  }

  return { noteOffsets, staffWidth: neededWidth }
}

function computeGridRows(opts: {
  startTime: number
  endTime: number
  staffWidth: number
  showStrums: boolean
  rhythm: RhythmInfo | null
  strums: StrumEvent[]
  gridMode?: GridMode
}): { countRow: string; strumRow: string } {
  const { startTime, endTime, staffWidth, showStrums, rhythm, strums, gridMode = 'auto' } = opts
  const empty = { countRow: ' '.repeat(staffWidth), strumRow: ' '.repeat(staffWidth) }
  if (!showStrums || !rhythm) return empty

  const subdivision = chooseSubdivision(gridMode, startTime, endTime, rhythm, strums)
  const slots = buildGridSlots(startTime, endTime, rhythm, subdivision)
  if (slots.length === 0) return empty

  const duration = Math.max(0.001, endTime - startTime)
  const toCol = (t: number) => {
    const ratio = (t - startTime) / duration
    const col = Math.round(ratio * (staffWidth - 1))
    return Math.max(0, Math.min(staffWidth - 1, col))
  }

  const countChars = Array.from({ length: staffWidth }, () => ' ')
  for (const slot of slots) {
    if (!slot.label) continue
    countChars[toCol(slot.time)] = slot.label
  }

  const quantized = quantizeStrumsToSlots(slots, strums)
  const strumChars = Array.from({ length: staffWidth }, () => ' ')
  for (const [slotIndex, qs] of quantized.entries()) {
    const t = slots[slotIndex]?.time
    if (typeof t !== 'number') continue
    strumChars[toCol(t)] = qs.direction === 'down' ? 'D' : 'U'
  }

  return {
    countRow: countChars.join(''),
    strumRow: strumChars.join(''),
  }
}

export function TabsSheet({ tabs, lyrics, strums, rhythm, onSeek }: TabsSheetProps) {
  const showHighlight = usePlayerPrefsStore((s) => s.lyricsMode !== 'none')
  const showStrums = usePlayerPrefsStore((s) => s.showStrums)
  const lines = useMemo(() => mergeTabsLyrics(tabs, lyrics), [tabs, lyrics])
  const { activeLineIndex, activeWordIndex, activeNoteTime } = useTabsSheetSync(lines)

  const scrollRef = useRef<HTMLDivElement>(null)
  const activeLineRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (showHighlight && activeLineRef.current && scrollRef.current) {
      activeLineRef.current.scrollIntoView({ behavior: 'auto', block: 'center' })
    }
  }, [activeLineIndex, showHighlight])

  useAutoScroll(scrollRef, !showHighlight)

  const handleSeek = useCallback(
    (time: number) => {
      onSeek?.(time)
    },
    [onSeek]
  )

  if (lines.length === 0) return null

  return (
    <div
      ref={scrollRef}
      className="flex-1 min-h-0 overflow-auto scrollbar-hide font-mono text-lg md:text-xl bg-charcoal-900/40 text-smoke-300 rounded-xl p-4"
      data-testid="tabs-sheet"
    >
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-semibold text-smoke-200">Tabs</h2>
        <span className="text-xs text-smoke-500">click a note to seek</span>
      </div>

      {lines.map((line, li) => {
        const isActive = li === activeLineIndex
        const isInstrumental = line.segmentIndex === -1

        const displayText =
          line.words.length > 0
            ? line.words.map((w) => w.word).join(' ')
            : (line.text || '')

        const baseWidth = estimateLineWidth(displayText, line.words.length)
        const { noteOffsets, staffWidth } = layoutLineNotes(line.notes, line.startTime, line.endTime, baseWidth)
        const baseDashes = '-'.repeat(staffWidth)

        const { countRow, strumRow } = computeGridRows({
          startTime: line.startTime,
          endTime: line.endTime,
          staffWidth,
          showStrums,
          rhythm,
          strums,
          gridMode: 'auto',
        })

        const isRtl = line.direction === 'rtl'

        return (
          <div
            key={li}
            ref={isActive ? activeLineRef : undefined}
            className={cn(
              'px-3 py-2 rounded-sm',
              isActive && showHighlight && 'chord-sheet-line-active',
              isRtl ? 'text-right' : 'text-left'
            )}
            dir={line.direction}
          >
            {/* Count + strum rows (tab-style) */}
            {showStrums ? (
              <div className="mb-2" dir="ltr">
                <div className="leading-5 whitespace-nowrap text-xs text-smoke-600 select-none">
                  {'  '}{countRow}
                </div>
                <div className="leading-5 whitespace-nowrap text-xs text-smoke-400 select-none">
                  {'  '}{strumRow}
                </div>
              </div>
            ) : null}

            {/* Tab staff (6 strings) */}
            <div className="flex flex-col gap-0.5" dir="ltr">
              {STRING_DISPLAY_ORDER.map((stringIndex) => {
                const label = STRING_LABELS_BY_INDEX[stringIndex]

                const notesForString = line.notes
                  .filter((n) => clampStringIndex(n.string) === stringIndex)
                  .sort((a, b) => a.start_time - b.start_time)

                return (
                  <div key={label} className="relative leading-5 whitespace-nowrap">
                    <span className="text-smoke-600 select-none">
                      {label}|{baseDashes}|
                    </span>

                    {notesForString.map((note, ni) => {
                      const isNoteActive = isActive && showHighlight && activeNoteTime >= 0 && Math.abs(note.start_time - activeNoteTime) < 0.05
                      const fretText = String(note.fret)
                      const offset = noteOffsets.get(note) ?? LABEL_PREFIX_WIDTH

                      return (
                        <span
                          key={`${note.start_time}-${note.string}-${note.fret}-${ni}`}
                          className={cn(
                            'absolute top-0 cursor-pointer font-semibold',
                            'px-0.5 rounded',
                            'bg-charcoal-950/70 hover:bg-charcoal-950',
                            isNoteActive ? 'text-flame-400' : 'text-smoke-100'
                          )}
                          style={{ left: `calc(${offset}ch - 0.125rem)` }}
                          role="button"
                          tabIndex={0}
                          aria-current={isNoteActive ? 'true' : undefined}
                          title={`String ${label}, fret ${note.fret} (${Math.round(note.confidence * 100)}%)`}
                          onClick={() => handleSeek(note.start_time)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault()
                              handleSeek(note.start_time)
                            }
                          }}
                        >
                          {fretText}
                        </span>
                      )
                    })}
                  </div>
                )
              })}
            </div>

            {/* Lyrics row / Instrumental label */}
            <div className="mt-2">
              {isInstrumental ? (
                <span className="text-smoke-500 italic text-xs">[Instrumental]</span>
              ) : (
                <div className={cn('leading-relaxed', (!isActive || !showHighlight) && 'text-smoke-500')}>
                  {line.words.length > 0 ? (
                    line.words.map((word, wi) => {
                      const isActiveWord = isActive && showHighlight && wi === activeWordIndex
                      return (
                        <span
                          key={wi}
                          className={cn(
                            'cursor-pointer rounded px-0.5',
                            isActiveWord
                              ? 'bg-flame-400 text-charcoal-950 font-semibold'
                              : isActive
                                ? 'text-smoke-100'
                                : 'hover:text-smoke-300'
                          )}
                          onClick={() => handleSeek(word.start)}
                        >
                          {word.word}{' '}
                        </span>
                      )
                    })
                  ) : (
                    <span
                      className={cn('cursor-pointer', isActive && showHighlight ? 'text-smoke-100' : '')}
                      onClick={() => handleSeek(line.startTime)}
                    >
                      {line.text}
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

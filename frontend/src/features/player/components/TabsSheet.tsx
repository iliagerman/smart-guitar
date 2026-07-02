import { memo, useRef, useEffect, useMemo, useCallback } from 'react'

import { mergeTabsLyrics, type PositionedTabNote, type TabsSheetLine as TabsSheetLineType } from '../lib/merge-tabs-lyrics'
import { getStrumGridDisplay, getSuggestedStrums } from '../lib/strum-pattern'
import { useTabsSheetSync } from '../hooks/use-tabs-sheet-sync'
import { useAutoScroll } from '../hooks/use-auto-scroll'
import { scrollToCenter } from '../lib/scroll-to-center'
import { cn } from '@/lib/cn'
import { usePlaybackStore } from '@/stores/playback.store'
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
  // toSorted (ES2023) would crash on the app's browser baseline (Vite's default build
  // target reaches Safari 14) with no polyfill, so a spread + sort is intentional.
  // oxlint-disable-next-line react-doctor/js-tosorted-immutable
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
}): { countRow: string; strumRow: string } {
  const { startTime, endTime, staffWidth, showStrums, rhythm, strums } = opts
  const empty = { countRow: ' '.repeat(staffWidth), strumRow: ' '.repeat(staffWidth) }
  if (!showStrums || !rhythm) return empty

  const { slots, quantized } = getStrumGridDisplay(startTime, endTime, strums, { rhythm })

  const duration = Math.max(0.001, endTime - startTime)
  const toCol = (t: number) => {
    const ratio = (t - startTime) / duration
    const col = Math.round(ratio * (staffWidth - 1))
    return Math.max(0, Math.min(staffWidth - 1, col))
  }

  if (slots.length === 0 || quantized.size === 0) {
    const suggestedStrums = getSuggestedStrums(startTime, endTime, strums)
    if (suggestedStrums.length === 0) return empty

    const strumChars = Array.from({ length: staffWidth }, () => ' ')
    for (const s of suggestedStrums) {
      strumChars[toCol(s.start_time)] = s.direction === 'down' ? 'D' : 'U'
    }

    return {
      countRow: ' '.repeat(staffWidth),
      strumRow: strumChars.join(''),
    }
  }

  const countChars = Array.from({ length: staffWidth }, () => ' ')
  for (const slot of slots) {
    if (!slot.label) continue
    countChars[toCol(slot.time)] = slot.label
  }

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

interface TabsSheetLineProps {
  line: TabsSheetLineType
  isActive: boolean
  showHighlight: boolean
  /** Already narrowed by the parent to -1 when the active word isn't on this line. */
  activeWordIndex: number
  /** Already narrowed by the parent to -1 when the active note isn't on this line. */
  activeNoteTime: number
  rhythm: RhythmInfo | null
  strums: StrumEvent[]
  activeLineRef: React.RefObject<HTMLDivElement | null>
  onSeek: (time: number) => void
}

/**
 * Renders a single tabs-sheet line (staff + count/strum rows + lyrics row).
 * Extracted from TabsSheet and memoized: the line's own layout (note offsets,
 * staff width, count/strum grid) only depends on the line/rhythm/strums data,
 * not on the active word/note tick, so it's memoized here and the whole
 * component is skipped by React.memo for lines untouched by the current tick.
 */
function TabsSheetLineImpl({
  line,
  isActive,
  showHighlight,
  activeWordIndex,
  activeNoteTime,
  rhythm,
  strums,
  activeLineRef,
  onSeek,
}: TabsSheetLineProps) {
  const isInstrumental = line.segmentIndex === -1

  const displayText =
    line.words.length > 0 ? line.words.map((w) => w.word).join(' ') : line.text || ''

  const { noteOffsets, staffWidth, baseDashes } = useMemo(() => {
    const baseWidth = estimateLineWidth(displayText, line.words.length)
    const layout = layoutLineNotes(line.notes, line.startTime, line.endTime, baseWidth)
    return { ...layout, baseDashes: '-'.repeat(layout.staffWidth) }
  }, [line, displayText])

  const { countRow, strumRow } = useMemo(
    () =>
      computeGridRows({
        startTime: line.startTime,
        endTime: line.endTime,
        staffWidth,
        showStrums: true,
        rhythm,
        strums,
      }),
    [line, staffWidth, rhythm, strums]
  )

  const isRtl = line.direction === 'rtl'

  return (
    <div
      ref={isActive ? activeLineRef : undefined}
      className={cn(
        'px-3 py-2 rounded-sm',
        isActive && showHighlight && 'chord-sheet-line-active',
        isRtl ? 'text-right' : 'text-left'
      )}
      dir={line.direction}
    >
      {/* Count + strum rows (tab-style) */}
      <div className="mb-2" dir="ltr">
        <div className="leading-5 whitespace-nowrap text-xs text-smoke-600 select-none">
          {'  '}
          {countRow}
        </div>
        <div className="leading-5 whitespace-nowrap text-xs text-smoke-400 select-none">
          {'  '}
          {strumRow}
        </div>
      </div>

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
                const isNoteActive =
                  isActive && showHighlight && activeNoteTime >= 0 && Math.abs(note.start_time - activeNoteTime) < 0.05
                const fretText = String(note.fret)
                const offset = noteOffsets.get(note) ?? LABEL_PREFIX_WIDTH

                return (
                  // Absolutely-positioned fret overlay with full button semantics
                  // already wired; a native <button>'s default box model would
                  // break the ch-based absolute positioning.
                  // oxlint-disable-next-line react-doctor/prefer-tag-over-role
                  <span role="button"
                    key={`${note.start_time}-${note.string}-${note.fret}-${ni}`}
                    className={cn(
                      'absolute top-0 cursor-pointer font-semibold',
                      'px-0.5 rounded',
                      'bg-charcoal-950/70 hover:bg-charcoal-950',
                      isNoteActive ? 'text-flame-400' : 'text-smoke-100'
                    )}
                    style={{ left: `calc(${offset}ch - 0.125rem)` }}
                    tabIndex={0}
                    aria-current={isNoteActive ? 'true' : undefined}
                    title={`String ${label}, fret ${note.fret} (${Math.round(note.confidence * 100)}%)`}
                    onClick={() => onSeek(note.start_time)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        onSeek(note.start_time)
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
                  // Inline clickable lyric word; a <button>'s inline-block box model
                  // would disrupt text flow/wrapping, so role="button" with keyboard
                  // handling is intentional.
                  // oxlint-disable-next-line react-doctor/prefer-tag-over-role
                  <span role="button"
                    key={`${word.start}-${word.word}`}
                    tabIndex={0}
                    className={cn(
                      'cursor-pointer rounded px-0.5',
                      isActiveWord
                        ? 'bg-flame-400 text-charcoal-950 font-semibold'
                        : isActive
                          ? 'text-smoke-100'
                          : 'hover:text-smoke-300'
                    )}
                    onClick={() => onSeek(word.start)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        onSeek(word.start)
                      }
                    }}
                  >
                    {word.word}{' '}
                  </span>
                )
              })
            ) : (
              // Inline clickable line text; a <button>'s inline-block box model would
              // disrupt text flow/wrapping, so role="button" with keyboard handling is intentional.
              // oxlint-disable-next-line react-doctor/prefer-tag-over-role
              <span role="button"
                tabIndex={0}
                className={cn('cursor-pointer', isActive && showHighlight ? 'text-smoke-100' : '')}
                onClick={() => onSeek(line.startTime)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    onSeek(line.startTime)
                  }
                }}
              >
                {line.text}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// Memoized: an unrelated line's props (isActive false, activeWordIndex/activeNoteTime
// -1 both before and after a tick) stay referentially/structurally identical while
// the active line moves elsewhere, so this line can skip re-rendering entirely.
const TabsSheetLine = memo(TabsSheetLineImpl)

export function TabsSheet({ tabs, lyrics, strums, rhythm, onSeek }: TabsSheetProps) {
  const showHighlight = usePlayerPrefsStore((s) => s.lyricsMode !== 'none')

  const lines = useMemo(() => mergeTabsLyrics(tabs, lyrics), [tabs, lyrics])
  const { activeLineIndex, activeWordIndex, activeNoteTime } = useTabsSheetSync(lines, { enabled: showHighlight })

  const scrollRef = useRef<HTMLDivElement>(null)
  const activeLineRef = useRef<HTMLDivElement>(null)
  const currentSongId = usePlaybackStore((s) => s.currentSongId)

  // Reset scroll to top when song changes
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = 0
    }
  }, [currentSongId])

  useEffect(() => {
    if (showHighlight && activeLineRef.current && scrollRef.current) {
      scrollToCenter(scrollRef.current, activeLineRef.current)
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
        // Narrow the broadcast active state to this line before it reaches
        // TabsSheetLine: an unrelated line's props then stay referentially
        // identical across renders (e.g. -1 both times) even while the
        // active word/note moves elsewhere, so React.memo can skip it.
        const isActive = li === activeLineIndex
        return (
          <TabsSheetLine
            key={line.startTime}
            line={line}
            isActive={isActive}
            showHighlight={showHighlight}
            activeWordIndex={isActive ? activeWordIndex : -1}
            activeNoteTime={isActive ? activeNoteTime : -1}
            rhythm={rhythm}
            strums={strums}
            activeLineRef={activeLineRef}
            onSeek={handleSeek}
          />
        )
      })}
    </div>
  )
}

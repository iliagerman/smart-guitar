import { useRef, useEffect, useCallback, useMemo, useState, type CSSProperties } from 'react'
import { X } from 'lucide-react'
import { mergeChordLyrics } from '../lib/merge-chords-lyrics'
import { useChordSheetSync } from '../hooks/use-chord-sheet-sync'
import { useAutoScroll } from '../hooks/use-auto-scroll'
import { readingScrollTop } from '../lib/scroll-to-center'
import { holdLabel, splitIntoBars, type ChordBeats } from '../lib/chord-beats'
import { BarLine } from './BarLine'
import { ChordHold } from './ChordHold'
import { ChordSheetLine } from './ChordSheetLine'
import { ChordVoicingPopover } from './ChordVoicingPopover'
import { getChordColor, formatChordWithBass } from '@/lib/chord-colors'
import { cn } from '@/lib/cn'
import { usePlaybackStore } from '@/stores/playback.store'
import { usePlayerPrefsStore } from '@/stores/player-prefs.store'
import type { ChordEntry, LyricsSegment } from '@/types/song'

interface WordLocation {
  segmentIndex: number
  wordIndex: number
}

interface ChordSheetProps {
  chords: ChordEntry[]
  lyrics: LyricsSegment[]
  onSeek?: (time: number) => void
  isEditMode?: boolean
  selectedChordIndex?: number | null
  selectedWordLocation?: WordLocation | null
  onChordSelect?: (globalIndex: number) => void
  onChordRename?: (globalIndex: number, newName: string) => void
  onChordDelete?: (globalIndex: number) => void
  onChordDrop?: (globalIndex: number, newStartTime: number) => void
  onWordClick?: (startTime: number) => void
  onWordRename?: (segmentIndex: number, wordIndex: number, newText: string) => void
  onWordSelect?: (location: WordLocation) => void
  /** The song's beat grid (first beat is a downbeat), for how long to hold each chord. */
  beatTimes?: readonly number[] | null
  beatsPerBar?: number
}

const DEFAULT_BEATS_PER_BAR = 4

/** Longest a smooth scroll takes; within it, asking for the same spot again is a no-op. */
const GLIDE_MS = 700

interface ChordLabelChord {
  chord: string
  start_time: number
  end_time: number
  bass?: string | null
  hold?: ChordBeats
  continued?: boolean
}

interface ChordLabelProps {
  chord: ChordLabelChord
  isActive: boolean
  isRtl: boolean
  onClick: () => void
  isEditMode?: boolean
  isSelected?: boolean
  onRename?: (newName: string) => void
  onDelete?: () => void
  globalIndex?: number
  onDragStart?: (e: React.DragEvent<HTMLButtonElement>) => void
  onSeek?: (time: number) => void
  /** The song's beat grid; shows how long the chord is held. */
  beatTimes?: readonly number[] | null
  beatsPerBar?: number
  /** Mark the bar line just before this chord. */
  barLine?: boolean
}

// Leaf render component: the booleans are independent rendering states of a single chord
// label (active / rtl / edit-mode / selected), not stackable variants, so compound
// components would not simplify it.
// oxlint-disable-next-line react-doctor/no-many-boolean-props
function ChordLabel({
  chord,
  isActive,
  isRtl,
  onClick,
  isEditMode,
  isSelected,
  onRename,
  onDelete,
  globalIndex,
  onDragStart,
  onSeek,
  beatTimes,
  beatsPerBar = DEFAULT_BEATS_PER_BAR,
  barLine,
}: ChordLabelProps) {
  const [isRenaming, setIsRenaming] = useState(false)
  // Draft value for the rename input, seeded from the prop and reset whenever rename mode
  // is entered; it intentionally diverges from chord.chord while the user is editing.
  // oxlint-disable-next-line react-doctor/no-derived-useState
  const [renameValue, setRenameValue] = useState(chord.chord)
  const showBassNotes = usePlayerPrefsStore((s) => s.showBassNotes)

  const handleDoubleClick = () => {
    if (!isEditMode || !onRename) return
    setRenameValue(chord.chord)
    setIsRenaming(true)
  }

  const commitRename = () => {
    if (renameValue.trim() && renameValue !== chord.chord) {
      onRename?.(renameValue.trim())
    }
    setIsRenaming(false)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') commitRename()
    if (e.key === 'Escape') setIsRenaming(false)
  }

  if (isRenaming) {
    return (
      <input
        type="text"
        value={renameValue}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setRenameValue(e.target.value)}
        onBlur={commitRename}
        onKeyDown={handleKeyDown}
        aria-label="Rename chord"
        className="w-16 rounded bg-charcoal-700 border border-flame-400 px-1 py-0.5 text-lg font-bold text-smoke-100 outline-none"
        data-testid="chord-rename-input"
      />
    )
  }

  const beats = !isEditMode && beatTimes ? chord.hold : undefined
  const holdTitle = beats ? `${chord.continued ? 'Keep holding' : 'Hold'} for ${holdLabel(beats.count, beatsPerBar)}` : undefined

  const chordButton = (
    <button
      type="button"
      dir="ltr"
      draggable={isEditMode}
      onDragStart={onDragStart}
      title={holdTitle}
      className={cn(
        'relative inline-flex min-w-0 flex-col rounded-md px-1 py-0.5 transition-colors whitespace-nowrap',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-flame-400/70',
        isRtl ? 'items-end justify-end text-right' : 'items-start justify-start text-left',
        isEditMode
          ? cn(
              'cursor-grab hover:bg-flame-400/10 border border-transparent',
              isSelected && 'border-flame-400 bg-flame-400/10'
            )
          : 'cursor-pointer hover:bg-charcoal-950/25',
        !isEditMode && isActive && 'chord-sheet-chord-active'
      )}
      style={{ unicodeBidi: 'isolate' }}
      onClick={onClick}
      onDoubleClick={handleDoubleClick}
      aria-current={isActive ? 'true' : undefined}
      data-chord-index={globalIndex}
    >
      {barLine && <BarLine className={isRtl ? '-right-1' : '-left-1'} />}
      <span
        dir="ltr"
        className={cn(
          getChordColor(chord.chord, 'dark'),
          'font-bold text-xl md:text-2xl leading-none',
          !isEditMode && chord.continued && 'opacity-55',
        )}
        style={{ unicodeBidi: 'isolate' }}
      >
        {formatChordWithBass(chord.chord, chord.bass, showBassNotes)}
      </span>
      {beats && beatTimes && (
        <ChordHold beats={beats} beatsPerBar={beatsPerBar} beatTimes={beatTimes} live={isActive} rtl={isRtl} />
      )}
    </button>
  )

  // Playback: tapping a chord opens the "how to play it" voicing browser.
  // Pass the slash bass through so the popover shows the true inversion.
  if (!isEditMode) {
    return (
      <ChordVoicingPopover
        chordName={formatChordWithBass(chord.chord, chord.bass, showBassNotes)}
        onPlayFromHere={onSeek ? () => onSeek(chord.start_time) : undefined}
      >
        {chordButton}
      </ChordVoicingPopover>
    )
  }

  // Edit mode: keep select / rename / drag / delete semantics, no popover.
  return (
    <div className="group relative inline-flex">
      {chordButton}
      {onDelete && (
        <button
          type="button"
          onClick={(e: React.MouseEvent<HTMLButtonElement>) => {
            e.stopPropagation()
            onDelete()
          }}
          className="absolute -top-1.5 -right-1.5 hidden group-hover:flex items-center justify-center size-4 rounded-full bg-red-500 text-white"
          aria-label="Delete chord"
          data-testid="chord-delete-btn"
        >
          <X size={10} />
        </button>
      )}
    </div>
  )
}

interface EditableWordProps {
  word: string
  segmentIndex: number
  wordIndex: number
  isSelected?: boolean
  onRename: (segmentIndex: number, wordIndex: number, newText: string) => void
  onSelect?: (segmentIndex: number, wordIndex: number) => void
}

function EditableWord({
  word,
  segmentIndex,
  wordIndex,
  isSelected,
  onRename,
  onSelect,
}: EditableWordProps) {
  const [isEditing, setIsEditing] = useState(false)
  // Draft value for the edit input, seeded from the prop and reset whenever editing is
  // entered; it intentionally diverges from `word` while the user is editing.
  // oxlint-disable-next-line react-doctor/no-derived-useState
  const [value, setValue] = useState(word)

  const handleDoubleClick = () => {
    setValue(word)
    setIsEditing(true)
  }

  const selectWord = () => {
    onSelect?.(segmentIndex, wordIndex)
  }

  const commit = () => {
    if (value.trim() && value !== word) {
      onRename(segmentIndex, wordIndex, value.trim())
    }
    setIsEditing(false)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') commit()
    if (e.key === 'Escape') setIsEditing(false)
  }

  if (isEditing) {
    return (
      <input
        type="text"
        value={value}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={handleKeyDown}
        aria-label="Edit lyric word"
        className="w-20 rounded bg-charcoal-700 border border-flame-400 px-0.5 text-lg text-smoke-100 outline-none"
        data-testid="word-rename-input"
      />
    )
  }

  return (
    // Inline clickable lyric word; a <button>'s inline-block box model would disrupt
    // text flow/wrapping in the sheet, so role="button" with keyboard handling is intentional.
    // oxlint-disable-next-line react-doctor/prefer-tag-over-role
    <span role="button"
      tabIndex={0}
      className={cn(
        'cursor-text hover:bg-flame-400/10 rounded px-0.5 text-smoke-300',
        isSelected && 'ring-2 ring-sky-400 bg-sky-400/10',
      )}
      onClick={selectWord}
      onDoubleClick={handleDoubleClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          selectWord()
        }
      }}
      title="Click to select timing · Double-click to edit text"
      data-testid={`word-edit-${segmentIndex}-${wordIndex}`}
    >
      {word}
    </span>
  )
}

export function ChordSheet({
  chords,
  lyrics,
  onSeek,
  isEditMode = false,
  selectedChordIndex,
  selectedWordLocation,
  onChordSelect,
  onChordRename,
  onChordDelete,
  onChordDrop,
  onWordClick,
  onWordRename,
  onWordSelect,
  beatTimes,
  beatsPerBar,
}: ChordSheetProps) {
  const showHighlight = usePlayerPrefsStore((s) => s.lyricsMode !== 'none')
  const showBeatCounts = usePlayerPrefsStore((s) => s.showBeatCounts)
  const countBeatTimes = showBeatCounts && !isEditMode && (beatTimes?.length ?? 0) > 1 ? beatTimes : null
  const barsBeatsPerBar = beatsPerBar ?? DEFAULT_BEATS_PER_BAR
  // With hold lengths on, chords are laid out bar by bar so each bar adds up to one.
  const sheetChords = useMemo(
    () => (countBeatTimes ? splitIntoBars(chords, countBeatTimes, barsBeatsPerBar) : chords),
    [chords, countBeatTimes, barsBeatsPerBar],
  )
  // Memoized: the merge is expensive (sorting, RTL detection, column layout) and the
  // sheet re-renders on every active word/chord change during playback.
  const lines = useMemo(() => mergeChordLyrics(sheetChords, lyrics), [sheetChords, lyrics])
  const { activeLineIndex, activeWordIndex, activeChordLineIndex, activeChordIndex } = useChordSheetSync(lines, {
    enabled: showHighlight,
  })
  const scrollRef = useRef<HTMLDivElement>(null)
  const activeLineRef = useRef<HTMLDivElement>(null)
  const activeWordRef = useRef<HTMLDivElement>(null)
  const glideRef = useRef({ top: -1, at: 0 })
  const dragIndexRef = useRef<number | null>(null)
  const currentSongId = usePlaybackStore((s) => s.currentSongId)

  // Reset scroll to top when song changes
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = 0
    }
  }, [currentSongId])

  // Follow the song a row at a time: once the active row leaves the reading
  // band, glide it back once. Re-aiming a glide that's already under way (or
  // nudging on every word) made the sheet shudder.
  useEffect(() => {
    if (isEditMode || !showHighlight || !scrollRef.current) return
    const container = scrollRef.current
    const activeEl = activeWordRef.current ?? activeLineRef.current
    if (!activeEl) return

    const top = readingScrollTop(container, activeEl)
    const now = performance.now()
    if (top === null || (top === glideRef.current.top && now - glideRef.current.at < GLIDE_MS)) return
    glideRef.current = { top, at: now }
    container.scrollTo({ top, behavior: 'smooth' })
  }, [activeLineIndex, activeWordIndex, showHighlight, isEditMode])

  useAutoScroll(scrollRef, !showHighlight || isEditMode)

  const handleChordClick = useCallback(
    (_time: number, globalIndex: number) => {
      // Playback: tapping opens the voicing popover, which owns "Play from here".
      // Edit mode: tapping selects the chord for editing.
      if (isEditMode) {
        onChordSelect?.(globalIndex)
      }
    },
    [isEditMode, onChordSelect]
  )

  const handleWordClick = useCallback(
    (time: number) => {
      if (isEditMode) {
        onWordClick?.(time)
      } else if (showHighlight) {
        onSeek?.(time)
      }
    },
    [isEditMode, showHighlight, onWordClick, onSeek]
  )

  const handleDragStart = useCallback(
    (globalIndex: number) => (e: React.DragEvent<HTMLButtonElement>) => {
      dragIndexRef.current = globalIndex
      e.dataTransfer.effectAllowed = 'move'
      e.dataTransfer.setData('text/plain', String(globalIndex))
    },
    []
  )

  const handleWordDragOver = useCallback((e: React.DragEvent<HTMLSpanElement>) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
  }, [])

  const handleWordDrop = useCallback(
    (wordStartTime: number) => (e: React.DragEvent<HTMLSpanElement>) => {
      e.preventDefault()
      const idx = dragIndexRef.current
      if (idx !== null && onChordDrop) {
        onChordDrop(idx, wordStartTime)
      }
      dragIndexRef.current = null
    },
    [onChordDrop]
  )

  // Build a global chord index map: for each line chord, find its index in the flat chords array.
  // We pre-build a Map<key, number[]> of flat-chord indices grouped by (start_time, chord) so
  // the inner lookup is O(1) instead of O(n). Indices within each bucket are kept in ascending
  // order and consumed left-to-right so that duplicate (start_time, chord) pairs are matched
  // in the same sequential order as the original findIndex(i >= globalIdx) guard.
  const globalChordIndexMap = useMemo(() => {
    const chordKeyBuckets = new Map<string, number[]>()
    for (let i = 0; i < sheetChords.length; i++) {
      const key = `${sheetChords[i].start_time}_${sheetChords[i].chord}`
      const bucket = chordKeyBuckets.get(key)
      if (bucket) {
        bucket.push(i)
      } else {
        chordKeyBuckets.set(key, [i])
      }
    }
    const bucketPointers = new Map<string, number>()
    const indexMap = new Map<object, number>()
    let globalIdx = 0
    for (const line of lines) {
      for (const chord of line.chords) {
        const key = `${chord.start_time}_${chord.chord}`
        const bucket = chordKeyBuckets.get(key)
        if (!bucket) continue
        let ptr = bucketPointers.get(key) ?? 0
        // Advance pointer past indices already consumed (< globalIdx)
        while (ptr < bucket.length && bucket[ptr] < globalIdx) ptr++
        if (ptr < bucket.length) {
          const matchIdx = bucket[ptr]
          indexMap.set(chord, matchIdx)
          globalIdx = matchIdx + 1
          bucketPointers.set(key, ptr + 1)
        }
      }
    }
    return indexMap
  }, [sheetChords, lines])

  const renderChordLabel = useCallback(
    ({ chord, ci, gci, isChordActive, isRtl: rtl, barLine }: {
      chord: ChordLabelChord
      ci: number
      gci: number
      isChordActive: boolean
      isRtl: boolean
      barLine: boolean
    }) => (
      <ChordLabel
        key={ci}
        chord={chord}
        isActive={isChordActive}
        isRtl={rtl}
        isEditMode={isEditMode}
        isSelected={isEditMode && gci === selectedChordIndex}
        globalIndex={gci}
        onClick={() => handleChordClick(chord.start_time, gci)}
        onRename={isEditMode ? (name) => onChordRename?.(gci, name) : undefined}
        onDelete={isEditMode ? () => onChordDelete?.(gci) : undefined}
        onDragStart={isEditMode ? handleDragStart(gci) : undefined}
        onSeek={isEditMode ? undefined : onSeek}
        beatTimes={countBeatTimes}
        beatsPerBar={barsBeatsPerBar}
        barLine={barLine}
      />
    ),
    [isEditMode, selectedChordIndex, handleChordClick, onChordRename, onChordDelete, handleDragStart, onSeek, countBeatTimes, barsBeatsPerBar]
  )

  const renderEditableWord = useCallback(
    ({ word, segmentIndex, wordIndex }: { word: string; segmentIndex: number; wordIndex: number }) => (
      <EditableWord
        word={word}
        segmentIndex={segmentIndex}
        wordIndex={wordIndex}
        isSelected={
          selectedWordLocation?.segmentIndex === segmentIndex &&
          selectedWordLocation?.wordIndex === wordIndex
        }
        onRename={onWordRename!}
        onSelect={onWordSelect
          ? (si, wi) => onWordSelect({ segmentIndex: si, wordIndex: wi })
          : undefined
        }
      />
    ),
    [onWordRename, onWordSelect, selectedWordLocation]
  )

  if (lines.length === 0) return null

  // Every chord row makes room for the hold pill, so the words stay on one line.
  const tickRowStyle = countBeatTimes ? ({ '--chord-row-h': '3rem' } as CSSProperties) : undefined

  return (
    <div
      ref={scrollRef}
      className={cn(
        'flex-1 min-h-0 overflow-y-auto overflow-x-hidden wrap-break-word scrollbar-hide font-mono text-[1.35rem] leading-relaxed text-smoke-200 p-4 sm:p-5 md:text-2xl',
        isEditMode
          ? 'bg-flame-400/8 ring-1 ring-inset ring-flame-400/30'
          : 'bg-[linear-gradient(180deg,rgba(18,20,24,0.94),rgba(9,10,12,0.96))]'
      )}
      style={tickRowStyle}
      data-testid="chord-sheet"
      data-song-scroll-container
    >
      {lines.map((line, li) => {
        // Narrow the broadcast active state to this line before it reaches
        // ChordSheetLine: an unrelated line's props then stay referentially
        // identical across renders (e.g. -1 both times) even while the active
        // word/chord moves elsewhere, so React.memo can skip re-rendering it.
        const isActive = li === activeLineIndex
        const lineActiveWordIndex = isActive ? activeWordIndex : -1
        const lineActiveChordIndex = li === activeChordLineIndex ? activeChordIndex : -1

        return (
          // Lines render in fixed positional order and never reorder, so the index
          // is a stable key here.
          // oxlint-disable-next-line react-doctor/no-array-index-key
          <ChordSheetLine key={li}
            line={line}
            isActive={isActive}
            showHighlight={showHighlight}
            isEditMode={isEditMode}
            activeWordIndex={lineActiveWordIndex}
            activeChordIndex={lineActiveChordIndex}
            selectedChordIndex={selectedChordIndex}
            globalChordIndexMap={globalChordIndexMap}
            activeLineRef={activeLineRef}
            activeWordRef={activeWordRef}
            onChordClick={handleChordClick}
            onWordClick={handleWordClick}
            onChordRename={onChordRename}
            onChordDelete={onChordDelete}
            onDragStart={handleDragStart}
            onWordDragOver={isEditMode ? handleWordDragOver : undefined}
            onWordDrop={handleWordDrop}
            onWordRename={onWordRename}
            renderChordLabel={renderChordLabel}
            renderEditableWord={onWordRename ? renderEditableWord : undefined}
          />
        )
      })}
    </div>
  )
}

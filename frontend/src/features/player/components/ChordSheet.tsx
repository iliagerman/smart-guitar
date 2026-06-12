import { useRef, useEffect, useCallback, useState } from 'react'
import { X } from 'lucide-react'
import { mergeChordLyrics } from '../lib/merge-chords-lyrics'
import { useChordSheetSync } from '../hooks/use-chord-sheet-sync'
import { useAutoScroll } from '../hooks/use-auto-scroll'
import { isElementVisible, scrollIntoContainerView } from '../lib/scroll-to-center'
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
}

const LOOK_AHEAD_WORDS = 20

function computeLookAheadWord(
  lines: ReturnType<typeof mergeChordLyrics>,
  activeLineIndex: number,
  activeWordIndex: number,
) {
  if (activeLineIndex < 0 || activeWordIndex < 0) return null
  let remaining = LOOK_AHEAD_WORDS
  const activeLine = lines[activeLineIndex]
  if (!activeLine) return null
  const wordsLeftInLine = activeLine.words.length - activeWordIndex - 1
  if (remaining <= wordsLeftInLine) {
    return { lineIndex: activeLineIndex, wordIndex: activeWordIndex + remaining }
  }
  remaining -= wordsLeftInLine
  let lastWordLocation: { lineIndex: number; wordIndex: number } | null = null
  for (let li = activeLineIndex + 1; li < lines.length; li++) {
    const lineWords = lines[li].words.length
    if (lineWords === 0) continue
    lastWordLocation = { lineIndex: li, wordIndex: lineWords - 1 }
    if (remaining <= lineWords) {
      return { lineIndex: li, wordIndex: remaining - 1 }
    }
    remaining -= lineWords
  }
  // Fewer than LOOK_AHEAD_WORDS remain — anchor to the last word so proactive scrolling
  // continues through the final stretch instead of silently stopping.
  return lastWordLocation
}


interface ChordLabelChord {
  chord: string
  start_time: number
  end_time: number
  bass?: string | null
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

  const chordButton = (
    <button
      type="button"
      dir="ltr"
      draggable={isEditMode}
      onDragStart={onDragStart}
      className={cn(
        'inline-flex min-w-0 rounded-md px-1 py-0.5 transition-colors whitespace-nowrap',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-flame-400/70',
        isRtl ? 'justify-end text-right' : 'justify-start text-left',
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
      <span
        dir="ltr"
        className={cn(getChordColor(chord.chord, 'dark'), 'font-bold text-xl md:text-2xl leading-none')}
        style={{ unicodeBidi: 'isolate' }}
      >
        {formatChordWithBass(chord.chord, chord.bass, showBassNotes)}
      </span>
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
}: ChordSheetProps) {
  const showHighlight = usePlayerPrefsStore((s) => s.lyricsMode !== 'none')
  const lines = mergeChordLyrics(chords, lyrics)
  const { activeLineIndex, activeWordIndex, activeChordIndex } = useChordSheetSync(lines)
  const scrollRef = useRef<HTMLDivElement>(null)
  const activeLineRef = useRef<HTMLDivElement>(null)
  const activeWordRef = useRef<HTMLDivElement>(null)
  const lookAheadWordRef = useRef<HTMLDivElement>(null)
  const dragIndexRef = useRef<number | null>(null)
  const currentSongId = usePlaybackStore((s) => s.currentSongId)

  // Reset scroll to top when song changes
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = 0
    }
  }, [currentSongId])

  useEffect(() => {
    if (isEditMode || !showHighlight || !scrollRef.current) return
    const container = scrollRef.current
    const activeEl = activeWordRef.current ?? activeLineRef.current
    const lookAheadEl = lookAheadWordRef.current

    if (!activeEl) return

    if (!isElementVisible(container, activeEl)) {
      scrollIntoContainerView(container, activeEl)
      return
    }

    if (lookAheadEl && !isElementVisible(container, lookAheadEl)) {
      const cRect = container.getBoundingClientRect()
      const activeRect = activeEl.getBoundingClientRect()
      const lookAheadRect = lookAheadEl.getBoundingClientRect()

      const padding = 60
      const desiredDelta = lookAheadRect.bottom - (cRect.bottom - padding)

      if (desiredDelta > 0) {
        const maxDelta = activeRect.top - (cRect.top + padding)
        const clampedDelta = Math.max(0, Math.min(desiredDelta, maxDelta))

        if (clampedDelta > 0) {
          container.scrollTo({
            top: container.scrollTop + clampedDelta,
            behavior: 'smooth',
          })
        }
      }
    }
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

  const lookAheadWord = computeLookAheadWord(lines, activeLineIndex, activeWordIndex)

  // Build a global chord index map: for each line chord, find its index in the flat chords array.
  // We pre-build a Map<key, number[]> of flat-chord indices grouped by (start_time, chord) so
  // the inner lookup is O(1) instead of O(n). Indices within each bucket are kept in ascending
  // order and consumed left-to-right so that duplicate (start_time, chord) pairs are matched
  // in the same sequential order as the original findIndex(i >= globalIdx) guard.
  const chordKeyBuckets = new Map<string, number[]>()
  for (let i = 0; i < chords.length; i++) {
    const key = `${chords[i].start_time}_${chords[i].chord}`
    const bucket = chordKeyBuckets.get(key)
    if (bucket) {
      bucket.push(i)
    } else {
      chordKeyBuckets.set(key, [i])
    }
  }
  const bucketPointers = new Map<string, number>()
  const globalChordIndexMap = new Map<object, number>()
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
        globalChordIndexMap.set(chord, matchIdx)
        globalIdx = matchIdx + 1
        bucketPointers.set(key, ptr + 1)
      }
    }
  }

  const renderChordLabel = useCallback(
    ({ chord, ci, gci, isChordActive, isRtl: rtl }: {
      chord: { chord: string; start_time: number; end_time: number }
      ci: number
      gci: number
      isChordActive: boolean
      isRtl: boolean
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
      />
    ),
    [isEditMode, selectedChordIndex, handleChordClick, onChordRename, onChordDelete, handleDragStart, onSeek]
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

  return (
    <div
      ref={scrollRef}
      className={cn(
        'flex-1 min-h-0 overflow-y-auto overflow-x-hidden wrap-break-word scrollbar-hide font-mono text-xl md:text-2xl text-smoke-300 rounded-xl p-4',
        isEditMode
          ? 'bg-charcoal-900/60 border border-dashed border-flame-400/30'
          : 'bg-charcoal-900/40'
      )}
      data-testid="chord-sheet"
    >
      {lines.map((line, li) => (
        // Lines render in fixed positional order and never reorder; the index is also
        // required as the lineIndex prop, so it is a stable key here.
        // oxlint-disable-next-line react-doctor/no-array-index-key
        <ChordSheetLine key={li}
          line={line}
          lineIndex={li}
          isActive={li === activeLineIndex}
          showHighlight={showHighlight}
          isEditMode={isEditMode}
          activeWordIndex={activeWordIndex}
          activeChordIndex={activeChordIndex}
          selectedChordIndex={selectedChordIndex}
          globalChordIndexMap={globalChordIndexMap}
          lookAheadWord={lookAheadWord}
          activeLineRef={activeLineRef}
          activeWordRef={activeWordRef}
          lookAheadWordRef={lookAheadWordRef}
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
      ))}
    </div>
  )
}

import { useRef, useEffect, useCallback, useState } from 'react'
import { X } from 'lucide-react'
import { mergeChordLyrics } from '../lib/merge-chords-lyrics'
import { useChordSheetSync } from '../hooks/use-chord-sheet-sync'
import { useAutoScroll } from '../hooks/use-auto-scroll'
import { isElementVisible, scrollIntoContainerView } from '../lib/scroll-to-center'
import { getChordColor, formatChordName } from '@/lib/chord-colors'
import { cn } from '@/lib/cn'
import { usePlayerPrefsStore } from '@/stores/player-prefs.store'
import type { ChordEntry, LyricsSegment } from '@/types/song'

interface ChordSheetProps {
  chords: ChordEntry[]
  lyrics: LyricsSegment[]
  onSeek?: (time: number) => void
  isEditMode?: boolean
  selectedChordIndex?: number | null
  onChordSelect?: (globalIndex: number) => void
  onChordRename?: (globalIndex: number, newName: string) => void
  onChordDelete?: (globalIndex: number) => void
  onChordDrop?: (globalIndex: number, newStartTime: number) => void
  onWordClick?: (startTime: number) => void
  onWordRename?: (segmentIndex: number, wordIndex: number, newText: string) => void
}

function estimateChordLabelWidth(chordName: string) {
  return formatChordName(chordName).length + 1
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
  for (let li = activeLineIndex + 1; li < lines.length; li++) {
    const lineWords = lines[li].words.length
    if (lineWords === 0) continue
    if (remaining <= lineWords) {
      return { lineIndex: li, wordIndex: remaining - 1 }
    }
    remaining -= lineWords
  }
  return null
}


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
}: {
  chord: { chord: string; start_time: number; end_time: number }
  isActive: boolean
  isRtl: boolean
  onClick: () => void
  isEditMode?: boolean
  isSelected?: boolean
  onRename?: (newName: string) => void
  onDelete?: () => void
  globalIndex?: number
  onDragStart?: (e: React.DragEvent<HTMLButtonElement>) => void
}) {
  const [isRenaming, setIsRenaming] = useState(false)
  const [renameValue, setRenameValue] = useState(chord.chord)

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
        autoFocus
        className="w-16 rounded bg-charcoal-700 border border-flame-400 px-1 py-0.5 text-lg font-bold text-smoke-100 outline-none"
        data-testid="chord-rename-input"
      />
    )
  }

  return (
    <div className="group relative inline-flex">
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
            : 'hover:bg-charcoal-950/25',
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
          {formatChordName(chord.chord)}
        </span>
      </button>
      {isEditMode && onDelete && (
        <button
          type="button"
          onClick={(e: React.MouseEvent<HTMLButtonElement>) => {
            e.stopPropagation()
            onDelete()
          }}
          className="absolute -top-1.5 -right-1.5 hidden group-hover:flex items-center justify-center w-4 h-4 rounded-full bg-red-500 text-white"
          aria-label="Delete chord"
          data-testid="chord-delete-btn"
        >
          <X size={10} />
        </button>
      )}
    </div>
  )
}

function EditableWord({
  word,
  segmentIndex,
  wordIndex,
  onRename,
}: {
  word: string
  segmentIndex: number
  wordIndex: number
  onRename: (segmentIndex: number, wordIndex: number, newText: string) => void
}) {
  const [isEditing, setIsEditing] = useState(false)
  const [value, setValue] = useState(word)

  const handleDoubleClick = () => {
    setValue(word)
    setIsEditing(true)
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
        autoFocus
        className="w-20 rounded bg-charcoal-700 border border-flame-400 px-0.5 text-lg text-smoke-100 outline-none"
        data-testid="word-rename-input"
      />
    )
  }

  return (
    <span
      className="cursor-text hover:bg-flame-400/10 rounded px-0.5 text-smoke-300"
      onDoubleClick={handleDoubleClick}
      title="Double-click to edit"
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
  onChordSelect,
  onChordRename,
  onChordDelete,
  onChordDrop,
  onWordClick,
  onWordRename,
}: ChordSheetProps) {
  const showHighlight = usePlayerPrefsStore((s) => s.lyricsMode !== 'none')
  const lines = mergeChordLyrics(chords, lyrics)
  const { activeLineIndex, activeWordIndex, activeChordIndex } = useChordSheetSync(lines)
  const scrollRef = useRef<HTMLDivElement>(null)
  const activeLineRef = useRef<HTMLDivElement>(null)
  const activeWordRef = useRef<HTMLDivElement>(null)
  const lookAheadWordRef = useRef<HTMLDivElement>(null)
  const dragIndexRef = useRef<number | null>(null)

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
    (time: number, globalIndex: number) => {
      if (isEditMode) {
        onChordSelect?.(globalIndex)
      } else {
        onSeek?.(time)
      }
    },
    [isEditMode, onChordSelect, onSeek]
  )

  const handleWordClick = useCallback(
    (time: number) => {
      if (isEditMode) {
        onWordClick?.(time)
      } else {
        onSeek?.(time)
      }
    },
    [isEditMode, onWordClick, onSeek]
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

  // Build a global chord index map: for each line chord, find its index in the flat chords array
  const globalChordIndexMap = new Map<object, number>()
  let globalIdx = 0
  for (const line of lines) {
    for (const chord of line.chords) {
      // Match by start_time since mergeChordLyrics creates new objects
      const matchIdx = chords.findIndex(
        (c, i) => i >= globalIdx && c.start_time === chord.start_time && c.chord === chord.chord
      )
      if (matchIdx !== -1) {
        globalChordIndexMap.set(chord, matchIdx)
        globalIdx = matchIdx + 1
      }
    }
  }

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
              !isEditMode && isActive && showHighlight && 'chord-sheet-line-active',
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
                  const gci = globalChordIndexMap.get(chord) ?? ci
                  const isChordActive = !isEditMode && isActive && showHighlight && ci === activeChordIndex
                  return (
                    <ChordLabel
                      key={ci}
                      chord={chord}
                      isActive={isChordActive}
                      isRtl={false}
                      isEditMode={isEditMode}
                      isSelected={isEditMode && gci === selectedChordIndex}
                      globalIndex={gci}
                      onClick={() => handleChordClick(chord.start_time, gci)}
                      onRename={isEditMode ? (name) => onChordRename?.(gci, name) : undefined}
                      onDelete={isEditMode ? () => onChordDelete?.(gci) : undefined}
                      onDragStart={isEditMode ? handleDragStart(gci) : undefined}
                    />
                  )
                })}
              </div>
            ) : (
              <div className={cn('leading-normal', !isEditMode && (!isActive || !showHighlight) && 'text-smoke-500')}>
                {line.words.length > 0 ? (
                  (() => {
                    let currentOffset = 0
                    return line.words.map((word, wi) => {
                      const isActiveWord = !isEditMode && isActive && showHighlight && wi === activeWordIndex
                      const isLookAheadWord = lookAheadWord?.lineIndex === li && lookAheadWord?.wordIndex === wi
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
                          ref={isActiveWord ? activeWordRef : isLookAheadWord ? lookAheadWordRef : undefined}
                          className="inline-flex flex-col align-top gap-1 px-1 pb-1"
                          style={{ minWidth: `${reservedWidthCh}ch` }}
                        >
                          <div
                            className={cn(
                              'min-h-7 flex flex-wrap gap-1',
                              isRtl ? 'justify-end' : 'justify-start',
                              isEditMode && wordChords.length === 0 && 'cursor-pointer hover:bg-flame-400/5 rounded',
                            )}
                            onClick={isEditMode && wordChords.length === 0 ? () => onWordClick?.(word.start) : undefined}
                            onDragOver={isEditMode ? handleWordDragOver : undefined}
                            onDrop={isEditMode ? handleWordDrop(word.start) : undefined}
                            title={isEditMode && wordChords.length === 0 ? `Click to add chord at ${word.start.toFixed(2)}s` : undefined}
                          >
                            {wordChords.map((chord, ci) => {
                              const gci = globalChordIndexMap.get(chord) ?? line.chords.indexOf(chord)
                              const isChordActive = !isEditMode && isActive && showHighlight && line.chords.indexOf(chord) === activeChordIndex
                              return (
                                <ChordLabel
                                  key={ci}
                                  chord={chord}
                                  isActive={isChordActive}
                                  isRtl={isRtl}
                                  isEditMode={isEditMode}
                                  isSelected={isEditMode && gci === selectedChordIndex}
                                  globalIndex={gci}
                                  onClick={() => handleChordClick(chord.start_time, gci)}
                                  onRename={isEditMode ? (name) => onChordRename?.(gci, name) : undefined}
                                  onDelete={isEditMode ? () => onChordDelete?.(gci) : undefined}
                                  onDragStart={isEditMode ? handleDragStart(gci) : undefined}
                                />
                              )
                            })}
                          </div>

                          {isEditMode && onWordRename ? (
                            <span className="rounded px-0.5">
                              <EditableWord
                                word={word.word}
                                segmentIndex={line.segmentIndex}
                                wordIndex={wi}
                                onRename={onWordRename}
                              />
                            </span>
                          ) : (
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
                          )}
                        </div>
                      )
                    })
                  })()
                ) : (
                  <div className="flex flex-col">
                    <div className="min-h-8 flex flex-wrap items-end gap-2">
                      {line.chords.map((chord, ci) => {
                        const gci = globalChordIndexMap.get(chord) ?? ci
                        const isChordActive = !isEditMode && isActive && showHighlight && ci === activeChordIndex
                        return (
                          <ChordLabel
                            key={ci}
                            chord={chord}
                            isActive={isChordActive}
                            isRtl={isRtl}
                            isEditMode={isEditMode}
                            isSelected={isEditMode && gci === selectedChordIndex}
                            globalIndex={gci}
                            onClick={() => handleChordClick(chord.start_time, gci)}
                            onRename={isEditMode ? (name) => onChordRename?.(gci, name) : undefined}
                            onDelete={isEditMode ? () => onChordDelete?.(gci) : undefined}
                            onDragStart={isEditMode ? handleDragStart(gci) : undefined}
                          />
                        )
                      })}
                    </div>
                    <span
                      className={cn(
                        'cursor-pointer',
                        !isEditMode && isActive && showHighlight ? 'text-smoke-100' : ''
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

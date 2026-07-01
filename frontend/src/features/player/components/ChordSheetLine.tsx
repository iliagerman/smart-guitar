import { cn } from '@/lib/cn'
import type { PositionedChord, ChordSheetLine as ChordSheetLineType } from '../lib/merge-chords-lyrics'
import type { LyricsWord } from '@/types/song'
import { formatChordName } from '@/lib/chord-colors'

interface ChordSheetLineProps {
  line: ChordSheetLineType
  lineIndex: number
  isActive: boolean
  showHighlight: boolean
  isEditMode: boolean
  activeWordIndex: number
  activeChordLineIndex: number
  activeChordIndex: number
  selectedChordIndex: number | null | undefined
  globalChordIndexMap: Map<object, number>
  lookAheadWord: { lineIndex: number; wordIndex: number } | null
  activeLineRef: React.RefObject<HTMLDivElement | null>
  activeWordRef: React.RefObject<HTMLDivElement | null>
  lookAheadWordRef: React.RefObject<HTMLDivElement | null>
  onChordClick: (time: number, globalIndex: number) => void
  onWordClick: (time: number) => void
  onChordRename?: (globalIndex: number, newName: string) => void
  onChordDelete?: (globalIndex: number) => void
  onDragStart: (globalIndex: number) => (e: React.DragEvent<HTMLButtonElement>) => void
  onWordDragOver?: (e: React.DragEvent<HTMLSpanElement>) => void
  onWordDrop: (wordStartTime: number) => (e: React.DragEvent<HTMLSpanElement>) => void
  onWordRename?: (segmentIndex: number, wordIndex: number, newText: string) => void
  renderChordLabel: (props: {
    chord: PositionedChord
    ci: number
    gci: number
    isChordActive: boolean
    isRtl: boolean
  }) => React.ReactNode
  renderEditableWord?: (props: {
    word: string
    segmentIndex: number
    wordIndex: number
  }) => React.ReactNode
}

function estimateChordLabelWidth(chordName: string) {
  return formatChordName(chordName).length + 1
}

interface WordLayoutData {
  wordChords: PositionedChord[]
  reservedWidthCh: number
}

/**
 * Pre-compute per-word chord assignments and layout widths for a line.
 * This avoids mutating variables during the render pass.
 */
function computeWordData(line: ChordSheetLineType): WordLayoutData[] {
  let currentOffset = 0
  return line.words.map((word, wi) => {
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
    return { wordChords, reservedWidthCh }
  })
}

/**
 * Renders a single line of the chord sheet (instrumental or lyrics line).
 * Extracted from ChordSheet to keep the main component render under 200 lines.
 */
export function ChordSheetLine({
  line,
  lineIndex,
  isActive,
  showHighlight,
  isEditMode,
  activeWordIndex,
  activeChordLineIndex,
  activeChordIndex,
  selectedChordIndex,
  globalChordIndexMap,
  lookAheadWord,
  activeLineRef,
  activeWordRef,
  lookAheadWordRef,
  onChordClick,
  onWordClick,
  onChordRename,
  onChordDelete,
  onDragStart,
  onWordDragOver,
  onWordDrop,
  onWordRename,
  renderChordLabel,
  renderEditableWord,
}: ChordSheetLineProps) {
  const isInstrumental = line.segmentIndex === -1
  const isRtl = line.direction === 'rtl'
  const lineActiveChordIndex = lineIndex === activeChordLineIndex ? activeChordIndex : -1

  return (
    <div
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
        <InstrumentalContent
          line={line}
          isActive={isActive}
          showHighlight={showHighlight}
          isEditMode={isEditMode}
          activeChordIndex={lineActiveChordIndex}
          globalChordIndexMap={globalChordIndexMap}
          renderChordLabel={renderChordLabel}
        />
      ) : (
        <LyricsContent
          line={line}
          lineIndex={lineIndex}
          isActive={isActive}
          showHighlight={showHighlight}
          isEditMode={isEditMode}
          isRtl={isRtl}
          activeWordIndex={activeWordIndex}
          activeChordIndex={lineActiveChordIndex}
          selectedChordIndex={selectedChordIndex}
          globalChordIndexMap={globalChordIndexMap}
          lookAheadWord={lookAheadWord}
          activeWordRef={activeWordRef}
          lookAheadWordRef={lookAheadWordRef}
          onChordClick={onChordClick}
          onWordClick={onWordClick}
          onChordRename={onChordRename}
          onChordDelete={onChordDelete}
          onDragStart={onDragStart}
          onWordDragOver={onWordDragOver}
          onWordDrop={onWordDrop}
          onWordRename={onWordRename}
          renderChordLabel={renderChordLabel}
          renderEditableWord={renderEditableWord}
        />
      )}
    </div>
  )
}

interface InstrumentalContentProps {
  line: ChordSheetLineType
  isActive: boolean
  showHighlight: boolean
  isEditMode: boolean
  activeChordIndex: number
  globalChordIndexMap: Map<object, number>
  renderChordLabel: (props: {
    chord: PositionedChord
    ci: number
    gci: number
    isChordActive: boolean
    isRtl: boolean
  }) => React.ReactNode
}

function InstrumentalContent({
  line,
  isActive,
  showHighlight,
  isEditMode,
  activeChordIndex,
  globalChordIndexMap,
  renderChordLabel,
}: InstrumentalContentProps) {
  return (
    <div className="flex flex-wrap gap-x-5 gap-y-3">
      <span className="text-smoke-500 italic text-xs w-full">
        [Instrumental]
      </span>
      {line.chords.map((chord, ci) => {
        const gci = globalChordIndexMap.get(chord) ?? ci
        const isChordActive = !isEditMode && isActive && showHighlight && ci === activeChordIndex
        return renderChordLabel({ chord, ci, gci, isChordActive, isRtl: false })
      })}
    </div>
  )
}

interface LyricsContentProps {
  line: ChordSheetLineType
  lineIndex: number
  isActive: boolean
  showHighlight: boolean
  isEditMode: boolean
  isRtl: boolean
  activeWordIndex: number
  activeChordIndex: number
  selectedChordIndex: number | null | undefined
  globalChordIndexMap: Map<object, number>
  lookAheadWord: { lineIndex: number; wordIndex: number } | null
  activeWordRef: React.RefObject<HTMLDivElement | null>
  lookAheadWordRef: React.RefObject<HTMLDivElement | null>
  onChordClick: (time: number, globalIndex: number) => void
  onWordClick: (time: number) => void
  onChordRename?: (globalIndex: number, newName: string) => void
  onChordDelete?: (globalIndex: number) => void
  onDragStart: (globalIndex: number) => (e: React.DragEvent<HTMLButtonElement>) => void
  onWordDragOver?: (e: React.DragEvent<HTMLSpanElement>) => void
  onWordDrop: (wordStartTime: number) => (e: React.DragEvent<HTMLSpanElement>) => void
  onWordRename?: (segmentIndex: number, wordIndex: number, newText: string) => void
  renderChordLabel: (props: {
    chord: PositionedChord
    ci: number
    gci: number
    isChordActive: boolean
    isRtl: boolean
  }) => React.ReactNode
  renderEditableWord?: (props: {
    word: string
    segmentIndex: number
    wordIndex: number
  }) => React.ReactNode
}

function LyricsContent(props: LyricsContentProps) {
  const { line, isActive, showHighlight, isEditMode, isRtl } = props
  return (
    <div className={cn('leading-normal', !isEditMode && showHighlight && !isActive && 'text-smoke-500')}>
      {line.words.length > 0 ? (
        <WordsWithChords
          line={props.line}
          lineIndex={props.lineIndex}
          isActive={isActive}
          showHighlight={showHighlight}
          isEditMode={isEditMode}
          isRtl={isRtl}
          activeWordIndex={props.activeWordIndex}
          activeChordIndex={props.activeChordIndex}
          globalChordIndexMap={props.globalChordIndexMap}
          lookAheadWord={props.lookAheadWord}
          activeWordRef={props.activeWordRef}
          lookAheadWordRef={props.lookAheadWordRef}
          onWordClick={props.onWordClick}
          onWordDragOver={props.onWordDragOver}
          onWordDrop={props.onWordDrop}
          onWordRename={props.onWordRename}
          renderChordLabel={props.renderChordLabel}
          renderEditableWord={props.renderEditableWord}
        />
      ) : (
        <ChordsOnlyLine
          line={line}
          isActive={isActive}
          showHighlight={showHighlight}
          isEditMode={isEditMode}
          isRtl={isRtl}
          activeChordIndex={props.activeChordIndex}
          globalChordIndexMap={props.globalChordIndexMap}
          onWordClick={props.onWordClick}
          renderChordLabel={props.renderChordLabel}
        />
      )}
    </div>
  )
}

interface WordsWithChordsProps {
  line: ChordSheetLineType
  lineIndex: number
  isActive: boolean
  showHighlight: boolean
  isEditMode: boolean
  isRtl: boolean
  activeWordIndex: number
  activeChordIndex: number
  globalChordIndexMap: Map<object, number>
  lookAheadWord: { lineIndex: number; wordIndex: number } | null
  activeWordRef: React.RefObject<HTMLDivElement | null>
  lookAheadWordRef: React.RefObject<HTMLDivElement | null>
  onWordClick: (time: number) => void
  onWordDragOver?: (e: React.DragEvent<HTMLSpanElement>) => void
  onWordDrop: (wordStartTime: number) => (e: React.DragEvent<HTMLSpanElement>) => void
  onWordRename?: (segmentIndex: number, wordIndex: number, newText: string) => void
  renderChordLabel: (props: {
    chord: PositionedChord
    ci: number
    gci: number
    isChordActive: boolean
    isRtl: boolean
  }) => React.ReactNode
  renderEditableWord?: (props: {
    word: string
    segmentIndex: number
    wordIndex: number
  }) => React.ReactNode
}

// Leaf render component: the booleans are independent rendering states of a line
// (active / highlight / edit-mode / rtl), not stackable variants.
// oxlint-disable-next-line react-doctor/no-many-boolean-props
function WordsWithChords({
  line,
  lineIndex,
  isActive,
  showHighlight,
  isEditMode,
  isRtl,
  activeWordIndex,
  activeChordIndex,
  globalChordIndexMap,
  lookAheadWord,
  activeWordRef,
  lookAheadWordRef,
  onWordClick,
  onWordDragOver,
  onWordDrop,
  onWordRename,
  renderChordLabel,
  renderEditableWord,
}: WordsWithChordsProps) {
  // Pre-compute word offsets and chord assignments before render
  const wordData = computeWordData(line)

  return (
    <>
      {line.words.map((word, wi) => {
        const { wordChords, reservedWidthCh } = wordData[wi]
        const isActiveWord = !isEditMode && isActive && showHighlight && wi === activeWordIndex
        const isLookAheadWord = lookAheadWord?.lineIndex === lineIndex && lookAheadWord?.wordIndex === wi

        return (
          // Words render in fixed positional order and never reorder; the index is also
          // required as the wordIndex prop, so it is a stable key here.
          // oxlint-disable-next-line react-doctor/no-array-index-key
          <WordColumn key={wi}
            word={word}
            wordIndex={wi}
            wordChords={wordChords}
            reservedWidthCh={reservedWidthCh}
            isActiveWord={isActiveWord}
            isLookAheadWord={isLookAheadWord}
            isActive={isActive}
            isEditMode={isEditMode}
            isRtl={isRtl}
            showHighlight={showHighlight}
            activeChordIndex={activeChordIndex}
            segmentIndex={line.segmentIndex}
            lineChords={line.chords}
            globalChordIndexMap={globalChordIndexMap}
            activeWordRef={activeWordRef}
            lookAheadWordRef={lookAheadWordRef}
            onWordClick={onWordClick}
            onWordDragOver={onWordDragOver}
            onWordDrop={onWordDrop}
            onWordRename={onWordRename}
            renderChordLabel={renderChordLabel}
            renderEditableWord={renderEditableWord}
          />
        )
      })}
    </>
  )
}

interface WordColumnProps {
  word: LyricsWord
  wordIndex: number
  wordChords: PositionedChord[]
  reservedWidthCh: number
  isActiveWord: boolean
  isLookAheadWord: boolean
  isActive: boolean
  isEditMode: boolean
  isRtl: boolean
  showHighlight: boolean
  activeChordIndex: number
  segmentIndex: number
  lineChords: PositionedChord[]
  globalChordIndexMap: Map<object, number>
  activeWordRef: React.RefObject<HTMLDivElement | null>
  lookAheadWordRef: React.RefObject<HTMLDivElement | null>
  onWordClick: (time: number) => void
  onWordDragOver?: (e: React.DragEvent<HTMLSpanElement>) => void
  onWordDrop: (wordStartTime: number) => (e: React.DragEvent<HTMLSpanElement>) => void
  onWordRename?: (segmentIndex: number, wordIndex: number, newText: string) => void
  renderChordLabel: (props: {
    chord: PositionedChord
    ci: number
    gci: number
    isChordActive: boolean
    isRtl: boolean
  }) => React.ReactNode
  renderEditableWord?: (props: {
    word: string
    segmentIndex: number
    wordIndex: number
  }) => React.ReactNode
}

// Leaf render component: the booleans are independent rendering states of a word column
// (active-word / look-ahead / active-line / edit-mode / rtl / highlight), not variants.
// oxlint-disable-next-line react-doctor/no-many-boolean-props
function WordColumn({
  word,
  wordIndex,
  wordChords,
  reservedWidthCh,
  isActiveWord,
  isLookAheadWord,
  isActive,
  isEditMode,
  isRtl,
  showHighlight,
  activeChordIndex,
  segmentIndex,
  lineChords,
  globalChordIndexMap,
  activeWordRef,
  lookAheadWordRef,
  onWordClick,
  onWordDragOver,
  onWordDrop,
  onWordRename,
  renderChordLabel,
  renderEditableWord,
}: WordColumnProps) {
  return (
    <div
      ref={isActiveWord ? activeWordRef : isLookAheadWord ? lookAheadWordRef : undefined}
      className="inline-flex flex-col align-top gap-1 px-1 pb-1"
      style={{ minWidth: `${reservedWidthCh}ch` }}
    >
      {/* Click-to-add-chord is an edit-mode-only affordance; role, tabIndex, keyboard and
          click handlers are all gated together on isEditMode, so when this is interactive it
          always carries role="button". The conditional role is intentional. */}
      {/* oxlint-disable-next-line react-doctor/no-static-element-interactions */}
      <div
        className={cn(
          'min-h-7 flex flex-wrap gap-1',
          isRtl ? 'justify-end' : 'justify-start',
          isEditMode && wordChords.length === 0 && 'cursor-pointer hover:bg-flame-400/5 rounded',
        )}
        role={isEditMode && wordChords.length === 0 ? 'button' : undefined}
        tabIndex={isEditMode && wordChords.length === 0 ? 0 : undefined}
        onClick={isEditMode && wordChords.length === 0 ? () => onWordClick(word.start) : undefined}
        onKeyDown={
          isEditMode && wordChords.length === 0
            ? (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  onWordClick(word.start)
                }
              }
            : undefined
        }
        onDragOver={isEditMode ? onWordDragOver : undefined}
        onDrop={isEditMode ? onWordDrop(word.start) : undefined}
        title={isEditMode && wordChords.length === 0 ? `Click to add chord at ${word.start.toFixed(2)}s` : undefined}
      >
        {wordChords.map((chord, ci) => {
          const gci = globalChordIndexMap.get(chord) ?? lineChords.indexOf(chord)
          const isChordActive = !isEditMode && isActive && showHighlight && lineChords.indexOf(chord) === activeChordIndex
          return renderChordLabel({ chord, ci, gci, isChordActive, isRtl })
        })}
      </div>

      {isEditMode && onWordRename && renderEditableWord ? (
        <span className="rounded px-0.5">
          {/* renderEditableWord is a render prop injected by the parent, which owns the
              concrete EditableWord component and its edit-handler closures; it is not an
              inline component definition. */}
          {/* oxlint-disable-next-line react-doctor/no-render-in-render */}
          {renderEditableWord({
            word: word.word,
            segmentIndex,
            wordIndex,
          })}
        </span>
      ) : (
        // Inline clickable lyric text; a <button>'s inline-block box model would disrupt
        // text flow/wrapping in the sheet, so role="button" with keyboard handling is intentional.
        // oxlint-disable-next-line react-doctor/prefer-tag-over-role
        <span role="button"
          tabIndex={0}
          className={cn(
            'cursor-pointer rounded px-0.5',
            isActiveWord
              ? 'bg-flame-400 text-charcoal-950 font-semibold'
              : isActive
                ? 'text-smoke-100'
                : 'hover:text-smoke-300'
          )}
          onClick={() => onWordClick(word.start)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              onWordClick(word.start)
            }
          }}
          title={`${word.start.toFixed(2)}s \u2013 ${word.end.toFixed(2)}s`}
        >
          {word.word}
        </span>
      )}
    </div>
  )
}

interface ChordsOnlyLineProps {
  line: ChordSheetLineType
  isActive: boolean
  showHighlight: boolean
  isEditMode: boolean
  isRtl: boolean
  activeChordIndex: number
  globalChordIndexMap: Map<object, number>
  onWordClick: (time: number) => void
  renderChordLabel: (props: {
    chord: PositionedChord
    ci: number
    gci: number
    isChordActive: boolean
    isRtl: boolean
  }) => React.ReactNode
}

// Leaf render component: the booleans are independent rendering states of a chords-only
// line (active / highlight / edit-mode / rtl), not stackable variants.
// oxlint-disable-next-line react-doctor/no-many-boolean-props
function ChordsOnlyLine({
  line,
  isActive,
  showHighlight,
  isEditMode,
  isRtl,
  activeChordIndex,
  globalChordIndexMap,
  onWordClick,
  renderChordLabel,
}: ChordsOnlyLineProps) {
  return (
    <div className="flex flex-col">
      <div className="min-h-8 flex flex-wrap items-end gap-2">
        {line.chords.map((chord, ci) => {
          const gci = globalChordIndexMap.get(chord) ?? ci
          const isChordActive = !isEditMode && isActive && showHighlight && ci === activeChordIndex
          return renderChordLabel({ chord, ci, gci, isChordActive, isRtl })
        })}
      </div>
      {/* Inline clickable line text; a <button>'s inline-block box model would disrupt
          text flow/wrapping in the sheet, so role="button" with keyboard handling is intentional. */}
      {/* oxlint-disable-next-line react-doctor/prefer-tag-over-role */}
      <span role="button"
        tabIndex={0}
        className={cn(
          'cursor-pointer',
          !isEditMode && isActive && showHighlight ? 'text-smoke-100' : ''
        )}
        onClick={() => onWordClick(line.startTime)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onWordClick(line.startTime)
          }
        }}
      >
        {line.text}
      </span>
    </div>
  )
}

import { useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { Maximize2, Minimize2, Play, Pause, Minus, Plus, ChevronsDown } from 'lucide-react'

import { usePlaybackStore } from '@/stores/playback.store'
import { usePlayerPrefsStore } from '@/stores/player-prefs.store'
import { useChordEditStore } from '@/stores/chord-edit.store'
import { ProcessButton } from '../../components/ProcessButton'
import { BackgroundProcessingCard } from '../../components/BackgroundProcessingCard'
import { ChordSheet } from '../../components/ChordSheet'
import { ChordEditToolbar } from '../../components/ChordEditToolbar'
import { TabsSheet } from '../../components/TabsSheet'
import { ChordMap } from '../../components/ChordMap'
import { CurrentChordPanel } from './CurrentChordPanel'
import type { SongDetail, LyricsSegment } from '@/types/song'
import type { StrumSymbol, SectionStrumPattern } from '../../lib/strum-pattern'

interface SongContentProps {
  songId: string
  detail: SongDetail
  headerTitle: string
  headerArtist: string
  hasStemsProcessed: boolean
  hasChords: boolean
  hasAnyLyrics: boolean
  hasTabs: boolean
  displayChords: { chord: string; start_time: number; end_time: number }[]
  activeLyrics: LyricsSegment[]
  chordNamesForMap: string[]
  representativeStrumPattern: StrumSymbol[]
  sectionStrumPatterns: SectionStrumPattern[]
  chordsLoading: boolean
  onTogglePlay: () => void
  onSeek: (time: number) => void
  onSaveChords: () => void
  isSavingChords: boolean
  onAddChordAtWord: (startTime: number) => void
  onOpenTutorial: () => void
}

/**
 * Main content area of the song detail page. Renders the chord sheet, tabs,
 * process button, background processing card, and chord map sidebar.
 */
export function SongContent({
  songId,
  detail,
  headerTitle,
  headerArtist,
  hasStemsProcessed,
  hasChords,
  hasAnyLyrics,
  hasTabs,
  displayChords,
  activeLyrics,
  chordNamesForMap,
  representativeStrumPattern,
  sectionStrumPatterns,
  chordsLoading,
  onTogglePlay,
  onSeek,
  onSaveChords,
  isSavingChords,
  onAddChordAtWord,
  onOpenTutorial,
}: SongContentProps) {
  const sheetMode = usePlaybackStore((s) => s.sheetMode)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const toggleFullscreen = useCallback(() => setIsFullscreen((v) => !v), [])

  const isEditMode = useChordEditStore((s) => s.isEditMode)
  const editingChords = useChordEditStore((s) => s.editingChords)
  const editingLyrics = useChordEditStore((s) => s.editingLyrics)
  const selectedEditChordIndex = useChordEditStore((s) => s.selectedChordIndex)
  const selectChord = useChordEditStore((s) => s.selectChord)
  const updateChordLabel = useChordEditStore((s) => s.updateChordLabel)
  const deleteChord = useChordEditStore((s) => s.deleteChord)
  const moveChordToTime = useChordEditStore((s) => s.moveChordToTime)
  const updateWordText = useChordEditStore((s) => s.updateWordText)
  const selectedWordLocation = useChordEditStore((s) => s.selectedWordLocation)
  const selectWord = useChordEditStore((s) => s.selectWord)

  const hasChordSheet = hasChords || hasAnyLyrics || chordsLoading
  const showBackgroundProcessing =
    hasStemsProcessed && hasChords && (!hasAnyLyrics || (sheetMode === 'tabs' && !hasTabs))

  return (
    <div className="relative z-10 flex-1 min-h-0 flex flex-col" data-testid="song-content">
      <div className="max-w-7xl mx-auto p-4 w-full flex-1 min-h-0 flex flex-col">
        <ProcessButton
          songId={songId}
          songTitle={headerTitle}
          songArtist={headerArtist}
          hasStemsProcessed={hasStemsProcessed}
          hasChords={hasChords}
          hasLyrics={hasAnyLyrics}
          hasTabs={hasTabs}
          stemNames={detail.stem_types.map(({ name }) => name)}
          activeJobId={detail.active_job?.id ?? null}
          downloadPending={detail.download_pending}
        />

        {hasStemsProcessed && hasChords && (
          <>
            <BackgroundProcessingCard
              jobId={detail.active_job?.id ?? null}
              show={showBackgroundProcessing}
              hasLyrics={hasAnyLyrics}
              hasTabs={hasTabs}
              showTabsStep={sheetMode === 'tabs'}
            />

            {hasChordSheet ? (
              <>
                {isFullscreen && createPortal(
                  <FullscreenOverlay
                    sheetMode={sheetMode}
                    hasTabs={hasTabs}
                    detail={detail}
                    activeLyrics={activeLyrics}
                    displayChords={displayChords}
                    onSeek={onSeek}
                    onTogglePlay={onTogglePlay}
                    onClose={toggleFullscreen}
                  />,
                  document.body,
                )}
                <div className="flex-1 min-h-0 flex flex-col lg:flex-row gap-4 items-stretch">
                  <CurrentChordPanel chords={displayChords} />
                  <div className="flex-1 min-w-0 min-h-0 flex flex-col relative">
                    {/* Fullscreen toggle — mobile only */}
                    <button
                      type="button"
                      onClick={toggleFullscreen}
                      className="absolute top-2 right-2 z-10 p-1.5 rounded-lg lg:hidden bg-charcoal-700/80 border border-charcoal-600 text-smoke-300 hover:text-smoke-100 hover:border-flame-400/30 transition-colors"
                      aria-label="Fullscreen"
                      title="Expand to fullscreen"
                      data-testid="fullscreen-toggle"
                    >
                      <Maximize2 size={18} />
                    </button>

                    {chordsLoading && !hasChords ? (
                      <div className="flex-1 flex items-center justify-center text-smoke-400" data-testid="chords-loading">
                        <div className="flex flex-col items-center gap-3">
                          <div className="h-6 w-6 animate-spin rounded-full border-2 border-smoke-600 border-t-flame-400" />
                          <span className="text-sm">Detecting chords...</span>
                        </div>
                      </div>
                    ) : sheetMode === 'tabs' && hasTabs ? (
                      <TabsSheet
                        tabs={detail.tabs}
                        lyrics={activeLyrics}
                        strums={detail.strums}
                        rhythm={detail.rhythm}
                        onSeek={onSeek}
                      />
                    ) : (
                      <>
                        {isEditMode && (
                          <ChordEditToolbar
                            onSave={onSaveChords}
                            isSaving={isSavingChords}
                          />
                        )}
                        <ChordSheet
                          chords={isEditMode ? editingChords : displayChords}
                          lyrics={isEditMode && editingLyrics ? editingLyrics : activeLyrics}
                          onSeek={onSeek}
                          isEditMode={isEditMode}
                          selectedChordIndex={selectedEditChordIndex}
                          selectedWordLocation={isEditMode ? selectedWordLocation : undefined}
                          onChordSelect={selectChord}
                          onChordRename={updateChordLabel}
                          onChordDelete={deleteChord}
                          onChordDrop={moveChordToTime}
                          onWordClick={isEditMode ? onAddChordAtWord : undefined}
                          onWordRename={isEditMode ? updateWordText : undefined}
                          onWordSelect={isEditMode ? selectWord : undefined}
                        />
                      </>
                    )}
                  </div>
                  <div className="hidden lg:flex w-full lg:w-80 lg:shrink-0 min-h-0 flex-col">
                    <ChordMap
                      chords={chordNamesForMap}
                      representativePattern={representativeStrumPattern}
                      sectionPatterns={sectionStrumPatterns}
                      bpm={detail.source_bpm ?? detail.rhythm?.bpm}
                      strumNotes={detail.strum_notes}
                      tutorialUrl={detail.tutorial_url}
                      tutorialLinks={detail.tutorial_links}
                      strumLoading={!detail.songsterr_status}
                      songKey={detail.song_key}
                      onOpenTutorial={onOpenTutorial}
                    />
                  </div>
                </div>
              </>
            ) : null}
          </>
        )}
      </div>
    </div>
  )
}

const SPEED_STEP = 10

interface FullscreenOverlayProps {
  sheetMode: string
  hasTabs: boolean
  detail: SongDetail
  activeLyrics: LyricsSegment[]
  displayChords: { chord: string; start_time: number; end_time: number }[]
  onSeek: (time: number) => void
  onTogglePlay: () => void
  onClose: () => void
}

function FullscreenOverlay({
  sheetMode,
  hasTabs,
  detail,
  activeLyrics,
  displayChords,
  onSeek,
  onTogglePlay,
  onClose,
}: FullscreenOverlayProps) {
  const isPlaying = usePlaybackStore((s) => s.isPlaying)
  const showHighlight = usePlayerPrefsStore((s) => s.lyricsMode !== 'none')
  const autoScrollSpeed = usePlayerPrefsStore((s) => s.autoScrollSpeed)
  const setAutoScrollSpeed = usePlayerPrefsStore((s) => s.setAutoScrollSpeed)

  return (
    <div className="fixed inset-0 z-[9999] bg-charcoal-950 flex flex-col">
      {/* Compact toolbar */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-charcoal-800 shrink-0">
        <button
          type="button"
          onClick={onTogglePlay}
          className="p-2 rounded-full bg-flame-400 text-charcoal-950 hover:bg-flame-300 transition-colors"
          aria-label={isPlaying ? 'Pause' : 'Play'}
          data-testid="fullscreen-play-pause"
        >
          {isPlaying ? <Pause size={18} /> : <Play size={18} />}
        </button>

        {!showHighlight && (
          <div className="flex items-center gap-1 ml-auto mr-auto rounded-lg px-1.5 py-1 bg-charcoal-700 border border-charcoal-600">
            <button
              type="button"
              onClick={() => setAutoScrollSpeed(autoScrollSpeed - SPEED_STEP)}
              className="p-1 rounded text-smoke-300 hover:text-smoke-100 transition-colors"
              aria-label="Slower scroll"
            >
              <Minus size={14} />
            </button>
            <ChevronsDown size={14} className="text-smoke-400" />
            <span className="font-mono text-xs text-smoke-200 min-w-[3ch] text-center">
              {autoScrollSpeed}
            </span>
            <button
              type="button"
              onClick={() => setAutoScrollSpeed(autoScrollSpeed + SPEED_STEP)}
              className="p-1 rounded text-smoke-300 hover:text-smoke-100 transition-colors"
              aria-label="Faster scroll"
            >
              <Plus size={14} />
            </button>
          </div>
        )}

        <button
          type="button"
          onClick={onClose}
          className="ml-auto p-1.5 rounded-lg bg-charcoal-700/80 border border-charcoal-600 text-smoke-300 hover:text-smoke-100 transition-colors"
          aria-label="Exit fullscreen"
          data-testid="fullscreen-close"
        >
          <Minimize2 size={18} />
        </button>
      </div>

      {/* Chord sheet content */}
      <div className="flex-1 min-h-0 flex flex-col p-4 pt-2">
        {sheetMode === 'tabs' && hasTabs ? (
          <TabsSheet
            tabs={detail.tabs}
            lyrics={activeLyrics}
            strums={detail.strums}
            rhythm={detail.rhythm}
            onSeek={onSeek}
          />
        ) : (
          <ChordSheet
            chords={displayChords}
            lyrics={activeLyrics}
            onSeek={onSeek}
          />
        )}
      </div>
    </div>
  )
}

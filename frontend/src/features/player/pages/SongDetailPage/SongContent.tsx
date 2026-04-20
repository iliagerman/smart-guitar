import { usePlaybackStore } from '@/stores/playback.store'
import { useChordEditStore } from '@/stores/chord-edit.store'
import { ProcessButton } from '../../components/ProcessButton'
import { BackgroundProcessingCard } from '../../components/BackgroundProcessingCard'
import { ChordSheet } from '../../components/ChordSheet'
import { StaticChordSheet } from '../../components/StaticChordSheet'
import { ChordEditToolbar } from '../../components/ChordEditToolbar'
import { TabsSheet } from '../../components/TabsSheet'
import { ChordMap } from '../../components/ChordMap'
import { CurrentChordPanel } from './CurrentChordPanel'
import type { SongDetail, LyricsSegment, StaticChordLine } from '@/types/song'
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
  hasStaticChords: boolean
  staticChords: StaticChordLine[]
  displayChords: { chord: string; start_time: number; end_time: number }[]
  activeLyrics: LyricsSegment[]
  chordNamesForMap: string[]
  representativeStrumPattern: StrumSymbol[]
  sectionStrumPatterns: SectionStrumPattern[]
  chordsLoading: boolean
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
  hasStaticChords,
  staticChords,
  displayChords,
  activeLyrics,
  chordNamesForMap,
  representativeStrumPattern,
  sectionStrumPatterns,
  chordsLoading,
  onSeek,
  onSaveChords,
  isSavingChords,
  onAddChordAtWord,
  onOpenTutorial,
}: SongContentProps) {
  const sheetMode = usePlaybackStore((s) => s.sheetMode)
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
              <div className="flex-1 min-h-0 flex flex-col lg:flex-row gap-4 items-stretch">
                <CurrentChordPanel chords={displayChords} />
                <div className="flex-1 min-w-0 min-h-0 flex flex-col">
                  {chordsLoading && !hasChords ? (
                    <div className="flex-1 flex items-center justify-center text-smoke-400" data-testid="chords-loading">
                      <div className="flex flex-col items-center gap-3">
                        <div className="h-6 w-6 animate-spin rounded-full border-2 border-smoke-600 border-t-flame-400" />
                        <span className="text-sm">Detecting chords...</span>
                      </div>
                    </div>
                  ) : sheetMode === 'static' && hasStaticChords ? (
                    <StaticChordSheet lines={staticChords} />
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
            ) : null}
          </>
        )}
      </div>
    </div>
  )
}

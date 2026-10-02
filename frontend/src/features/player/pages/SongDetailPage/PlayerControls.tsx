import { lazy, Suspense, type ReactNode } from 'react'
import { ArrowDownUp, Pencil, Timer } from 'lucide-react'

import { resumeMetronomeAudio } from '@/features/metronome/lib/metronome-audio'
import { songTempoBpm } from '@/features/metronome/lib/song-beat-grid'
import { usePlaybackStore } from '@/stores/playback.store'
import { usePlayerPrefsStore } from '@/stores/player-prefs.store'
import { useSongViewStore } from '@/stores/song-view.store'
import type { LyricsSourceMode } from '@/stores/player-prefs.store'
import type { SongDetail, ChordOption } from '@/types/song'
import { useChordEditStore } from '@/stores/chord-edit.store'

import { ABLoopControl } from '../../components/ABLoopControl'
import { ChordMapDialog } from '../../components/ChordMapDialog'
import { LyricsSourceSelector } from '../../components/LyricsSourceSelector'
import { LyricsSyncControl } from '../../components/LyricsSyncControl'
import { ChordDisplayControls } from '../../components/ChordDisplayControls'
import { CountInToggle } from '../../components/CountInToggle'
import { HighlightToggle } from '../../components/HighlightToggle'
import { PlaybackSpeedSelector } from '../../components/PlaybackSpeedSelector'
import { ScrollModeControl } from '../../components/ScrollModeControl'
import { SheetSelector } from '../../components/SheetSelector'
import { SkipInstrumentalsToggle } from '../../components/SkipInstrumentalsToggle'
import { TrackSelector } from '../../components/TrackSelector'
import { TransportControls } from '../../components/TransportControls'
import type { LyricsSourceOption } from '../../lib/lyrics-sources'
import type { StrumSymbol, SectionStrumPattern } from '../../lib/strum-pattern'
import { dockPillClass } from '../../lib/dock-button'
import { toolButtonClass } from '../../lib/tool-button'

// Recording pulls in the mp3-encoder bundle; load it only when the controls
// actually mount instead of shipping it in the core player chunk.
const RecordButton = lazy(() =>
  import('../../components/RecordButton').then((m) => ({ default: m.RecordButton })),
)

interface PlayerControlsProps {
  songId: string
  isPlaybackDisabled?: boolean
  hasSyncedLyrics: boolean
  /** While playing on a phone: these replace the settings toggle next to the seek bar. */
  focusControls?: ReactNode
  onTogglePlay: () => void
  onSeek: (time: number) => void
}

interface SheetPickersProps {
  hasTabs: boolean
  hasBars: boolean
  sheetVersions: ChordOption[]
  activeChords: { chord: string; start_time: number; end_time: number }[]
  selectedVersionIndex: number
  availableLyricsSources: LyricsSourceOption[]
  selectedLyricsSource: LyricsSourceMode
  userEmail: string | null
  chordsUpgrading: boolean
  onSetVersionIndex: (idx: number) => void
  onSetLyricsSource: (mode: LyricsSourceMode) => void
  onDeleteChords: () => void
}

/** The sheet's settings (view, capo, chord source) and the lyrics source, at the end of the song tools. */
export function SheetPickers({
  hasTabs,
  hasBars,
  sheetVersions,
  activeChords,
  selectedVersionIndex,
  availableLyricsSources,
  selectedLyricsSource,
  userEmail,
  chordsUpgrading,
  onSetVersionIndex,
  onSetLyricsSource,
  onDeleteChords,
}: SheetPickersProps) {
  return (
    <>
      <SheetSelector
        versions={sheetVersions}
        selectedVersionIndex={selectedVersionIndex}
        activeChords={activeChords}
        hasTabs={hasTabs}
        hasBars={hasBars}
        currentUserEmail={userEmail ?? undefined}
        upgrading={chordsUpgrading}
        onSelectVersionIndex={onSetVersionIndex}
        onDeleteCurrentVersion={onDeleteChords}
      />
      <LyricsSourceSelector
        options={availableLyricsSources}
        selected={selectedLyricsSource}
        onSelect={onSetLyricsSource}
      />
    </>
  )
}

interface AudioStatusBannerProps {
  message?: string
}

export function AudioStatusBanner({ message }: AudioStatusBannerProps) {
  const activeStems = usePlaybackStore((s) => s.activeStems)
  const isFullSong = usePlaybackStore((s) => s.isFullSong)

  const fallbackMessage = isFullSong
    ? 'Downloading audio...'
    : `Preparing ${activeStems.map((stem) => stem.replaceAll('_', ' ')).join(', ')}...`

  return (
    <div
      className="flex items-center justify-center gap-2 rounded-2xl border border-flame-400/20 bg-flame-400/10 px-3 py-2 text-sm font-medium text-flame-100 shadow-[0_10px_30px_rgba(0,0,0,0.18)]"
      aria-live="polite"
    >
      <span>{message ?? fallbackMessage}</span>
    </div>
  )
}

/**
 * The player dock: seek bar, transport, and the speed/loop/count-in and
 * display settings. The sheet's own pickers live on the sheet (SheetBar).
 */
export function PlayerControls({
  songId,
  isPlaybackDisabled = false,
  hasSyncedLyrics,
  focusControls,
  onTogglePlay,
  onSeek,
}: PlayerControlsProps) {
  return (
    <div data-testid="player-controls">
      <TransportControls
        onTogglePlay={onTogglePlay}
        onSeek={onSeek}
        isPlaybackDisabled={isPlaybackDisabled}
        focusControls={focusControls}
        quickControls={
          <>
            <PlaybackSpeedSelector />
            <ABLoopControl />
            <CountInToggle />
          </>
        }
        secondaryControls={
          <>
            <ChordDisplayControls />
            <HighlightToggle />
            <LyricsSyncControl songId={songId} />
            <ScrollModeControl />
            <SkipInstrumentalsToggle disabled={!hasSyncedLyrics} />
          </>
        }
      />
    </div>
  )
}

/** While playing on a phone or tablet: show or hide the strumming pattern and the metronome. */
export function FocusToggles() {
  const showStrum = usePlayerPrefsStore((s) => s.focusShowStrum)
  const toggleStrum = usePlayerPrefsStore((s) => s.toggleFocusShowStrum)
  const metronomeOpen = useSongViewStore((s) => s.metronomeOpen)
  const toggleMetronome = useSongViewStore((s) => s.toggleMetronome)
  const toggleClass = (on: boolean) => dockPillClass(on, 'size-9 justify-center gap-0 px-0')

  return (
    <div className="flex shrink-0 items-center gap-1.5" data-testid="focus-toggles">
      <button
        type="button"
        onClick={toggleStrum}
        className={toggleClass(showStrum)}
        aria-label={showStrum ? 'Hide the strumming pattern' : 'Show the strumming pattern'}
        aria-pressed={showStrum}
        data-testid="focus-strum-toggle"
      >
        <ArrowDownUp size={16} aria-hidden="true" />
      </button>
      <button
        type="button"
        onClick={() => {
          if (!metronomeOpen) resumeMetronomeAudio()
          toggleMetronome()
        }}
        className={toggleClass(metronomeOpen)}
        aria-label={metronomeOpen ? 'Hide the metronome' : 'Show the metronome'}
        aria-pressed={metronomeOpen}
        data-testid="focus-metronome-toggle"
      >
        <Timer size={16} aria-hidden="true" />
      </button>
    </div>
  )
}

/** The song's tools — record, edit, mixer, chord map, metronome — with the sheet pickers at the end. */
export function PlayerTools({ trailing, ...props }: PrimaryControlsProps & { trailing?: ReactNode }) {
  return (
    <div className="flex w-full items-center gap-0.5" data-testid="player-tools">
      <PrimaryControls {...props} />
      {trailing && <div className="ml-auto flex shrink-0 items-center gap-1.5 pl-2">{trailing}</div>}
    </div>
  )
}

export interface PrimaryControlsProps {
  detail: SongDetail
  headerTitle: string
  headerArtist: string
  hasChords: boolean
  isStemSelectionDisabled?: boolean
  chordNamesForMap: string[]
  representativeStrumPattern: StrumSymbol[]
  sectionStrumPatterns: SectionStrumPattern[]
  onEnterEditMode: () => void
  onOpenTutorial: () => void
  onSetStemVolume: (stemName: string, volume: number) => void
  stemVolumes?: Record<string, number>
  getRecordingTap: () => { context: AudioContext; node: GainNode } | null
}

function PrimaryControls({
  detail,
  headerTitle,
  headerArtist,
  hasChords,
  isStemSelectionDisabled = false,
  chordNamesForMap,
  representativeStrumPattern,
  sectionStrumPatterns,
  onEnterEditMode,
  onOpenTutorial,
  onSetStemVolume,
  stemVolumes,
  getRecordingTap,
}: PrimaryControlsProps) {
  const isEditMode = useChordEditStore((s) => s.isEditMode)
  const showMetronome = useSongViewStore((s) => s.metronomeOpen)
  const toggleMetronome = useSongViewStore((s) => s.toggleMetronome)

  return (
    <>
      <Suspense fallback={<div className="h-12 w-[3.4rem] rounded-xl" aria-hidden="true" />}>
        <RecordButton songTitle={headerTitle} artist={headerArtist} getRecordingTap={getRecordingTap} />
      </Suspense>
      <div className="contents" data-tour="chord-edit">
        {hasChords && !isEditMode && (
          <button
            type="button"
            onClick={onEnterEditMode}
            className={toolButtonClass()}
            aria-label="Edit chords"
            data-testid="chord-edit-toggle"
          >
            <Pencil size={18} className="text-fire-400" />
            <span>Edit</span>
          </button>
        )}
      </div>
      <div className="contents" data-tour="stem-selector">
        <TrackSelector
          onSetStemVolume={onSetStemVolume}
          stemVolumes={stemVolumes}
          availableStems={detail.stems}
          stemTypes={detail.stem_types}
          isDisabled={isStemSelectionDisabled}
        />
      </div>
      <div className="contents" data-tour="chord-map">
        <ChordMapDialog
          chords={chordNamesForMap}
          representativePattern={representativeStrumPattern}
          sectionPatterns={sectionStrumPatterns}
          bpm={songTempoBpm(detail) ?? undefined}
          strumNotes={detail.strum_notes}
          tutorialUrl={detail.tutorial_url}
          tutorialLinks={detail.tutorial_links}
          strumLoading={!detail.songsterr_status}
          beatsPerBar={detail.time_signature?.[0]}
          strumAccents={detail.strum_accents}
          iconOnly
          onOpenTutorial={onOpenTutorial}
        />
      </div>
      <button
        type="button"
        onClick={() => {
          if (!showMetronome) resumeMetronomeAudio()
          toggleMetronome()
        }}
        className={toolButtonClass(showMetronome)}
        aria-label={showMetronome ? 'Close metronome' : 'Open metronome'}
        aria-pressed={showMetronome}
        data-testid="song-metronome-toggle"
      >
        <Timer size={18} className="text-fire-400" aria-hidden="true" />
        <span>Metro</span>
      </button>
    </>
  )
}

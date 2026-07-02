import { lazy, Suspense, useState } from 'react'
import { Heart, Pause, Pencil, Play, Timer, X } from 'lucide-react'

import { LoadingSpinner } from '@/components/shared/LoadingSpinner'
import { MetronomePanel } from '@/features/metronome/components/MetronomePanel'
import { cn } from '@/lib/cn'
import { usePlaybackStore } from '@/stores/playback.store'
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
import { TrackSelector } from '../../components/TrackSelector'
import { TransportControls } from '../../components/TransportControls'
import type { LyricsSourceOption } from '../../lib/lyrics-sources'
import type { StrumSymbol, SectionStrumPattern } from '../../lib/strum-pattern'

// Recording pulls in ffmpeg + mp3-encoder bundles; load them only when the
// controls actually mount instead of shipping them in the core player chunk.
const RecordButton = lazy(() =>
  import('../../components/RecordButton').then((m) => ({ default: m.RecordButton })),
)

interface PlayerControlsProps {
  songId: string
  detail: SongDetail
  headerTitle: string
  headerArtist: string
  hasChords: boolean
  hasTabs: boolean
  hasBars: boolean
  isFavorited: boolean
  showAudioStatus: boolean
  audioStatusMessage?: string
  isPlaybackDisabled?: boolean
  sheetVersions: ChordOption[]
  activeChords: { chord: string; start_time: number; end_time: number }[]
  selectedVersionIndex: number
  availableLyricsSources: LyricsSourceOption[]
  selectedLyricsSource: LyricsSourceMode
  chordNamesForMap: string[]
  representativeStrumPattern: StrumSymbol[]
  sectionStrumPatterns: SectionStrumPattern[]
  userEmail: string | null
  chordsUpgrading: boolean
  onTogglePlay: () => void
  onSeek: (time: number) => void
  onToggleFavorite: () => void
  onEnterEditMode: () => void
  onSetVersionIndex: (idx: number) => void
  onSetLyricsSource: (mode: LyricsSourceMode) => void
  onDeleteChords: () => void
  onOpenTutorial: () => void
  onSetStemVolume: (stemName: string, volume: number) => void
  stemVolumes?: Record<string, number>
  getRecordingTap: () => { context: AudioContext; node: GainNode } | null
}

interface AudioStatusBannerProps {
  message?: string
}

function AudioStatusBanner({ message }: AudioStatusBannerProps) {
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
      <LoadingSpinner size="xs" inline />
      <span>{message ?? fallbackMessage}</span>
    </div>
  )
}

/**
 * Renders the transport controls with primary action buttons and the simplified
 * sheet/lyrics controls used for source switching on mobile.
 */
// Composition component that threads distinct, independent player features down to the
// transport controls; the boolean flags are domain state, not stackable variants.
// oxlint-disable-next-line react-doctor/no-many-boolean-props
export function PlayerControls({
  songId,
  detail,
  headerTitle,
  headerArtist,
  hasChords,
  hasTabs,
  hasBars,
  isFavorited,
  showAudioStatus,
  audioStatusMessage,
  isPlaybackDisabled = false,
  sheetVersions,
  activeChords,
  selectedVersionIndex,
  availableLyricsSources,
  selectedLyricsSource,
  chordNamesForMap,
  representativeStrumPattern,
  sectionStrumPatterns,
  userEmail,
  chordsUpgrading,
  onTogglePlay,
  onSeek,
  onToggleFavorite,
  onEnterEditMode,
  onSetVersionIndex,
  onSetLyricsSource,
  onDeleteChords,
  onOpenTutorial,
  onSetStemVolume,
  stemVolumes,
  getRecordingTap,
}: PlayerControlsProps) {
  return (
    <div className="flex flex-col gap-3" data-testid="player-controls">
      {showAudioStatus && <AudioStatusBanner message={audioStatusMessage} />}
      <TransportControls
        onTogglePlay={onTogglePlay}
        onSeek={onSeek}
        isPlaybackDisabled={isPlaybackDisabled}
        primaryControls={
          <PrimaryControls
            songId={songId}
            detail={detail}
            headerTitle={headerTitle}
            headerArtist={headerArtist}
            hasChords={hasChords}
            isFavorited={isFavorited}
            isStemSelectionDisabled={isPlaybackDisabled}
            chordNamesForMap={chordNamesForMap}
            representativeStrumPattern={representativeStrumPattern}
            sectionStrumPatterns={sectionStrumPatterns}
            onToggleFavorite={onToggleFavorite}
            onTogglePlay={onTogglePlay}
            onEnterEditMode={onEnterEditMode}
            onOpenTutorial={onOpenTutorial}
            onSetStemVolume={onSetStemVolume}
            stemVolumes={stemVolumes}
            getRecordingTap={getRecordingTap}
          />
        }
        pinnedControls={
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
        }
        secondaryControls={
          <>
            <ChordDisplayControls />
            <HighlightToggle />
            <PlaybackSpeedSelector />
            <LyricsSyncControl />
            <ScrollModeControl />
            <CountInToggle />
            <ABLoopControl />
          </>
        }
      />
    </div>
  )
}

interface PrimaryControlsProps {
  songId: string
  detail: SongDetail
  headerTitle: string
  headerArtist: string
  hasChords: boolean
  isFavorited: boolean
  isStemSelectionDisabled?: boolean
  chordNamesForMap: string[]
  representativeStrumPattern: StrumSymbol[]
  sectionStrumPatterns: SectionStrumPattern[]
  onToggleFavorite: () => void
  onEnterEditMode: () => void
  onOpenTutorial: () => void
  onSetStemVolume: (stemName: string, volume: number) => void
  stemVolumes?: Record<string, number>
  getRecordingTap: () => { context: AudioContext; node: GainNode } | null
  onTogglePlay: () => void
}

interface MetronomePopupProps {
  autoBpm: number | null
  onTogglePlay: () => void
  onClose: () => void
}

/**
 * Floating metronome panel. Owns the per-tick `currentTime` subscription so the
 * rest of the primary controls don't re-render on every playback time update —
 * this only mounts while the metronome is open.
 */
function MetronomePopup({ autoBpm, onTogglePlay, onClose }: MetronomePopupProps) {
  const currentTime = usePlaybackStore((s) => s.currentTime)
  const isPlaying = usePlaybackStore((s) => s.isPlaying)

  return (
    <div className="fixed inset-x-2 top-2 z-50 rounded-[1.5rem] border border-white/10 bg-black/92 p-2 shadow-[0_18px_70px_rgba(0,0,0,0.55)] backdrop-blur-2xl sm:inset-x-4 sm:top-4">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onTogglePlay}
          className="grid size-11 shrink-0 place-items-center rounded-full bg-flame-300 text-charcoal-950 shadow-[0_0_30px_rgba(250,204,21,0.28)] transition-colors hover:bg-flame-400"
          aria-label={isPlaying ? 'Pause song' : 'Start song'}
        >
          {isPlaying ? <Pause size={19} aria-hidden="true" /> : <Play size={19} aria-hidden="true" />}
        </button>
        <MetronomePanel
          autoBpm={autoBpm}
          mode="playback"
          playbackTime={currentTime}
          playbackPlaying={isPlaying}
          compact
        />
        <button
          type="button"
          onClick={onClose}
          className="grid size-10 shrink-0 place-items-center rounded-full border border-white/10 bg-white/10 text-smoke-200 transition-colors hover:bg-white/15"
          aria-label="Close metronome"
        >
          <X size={18} aria-hidden="true" />
        </button>
      </div>
    </div>
  )
}

function PrimaryControls({
  songId,
  detail,
  headerTitle,
  headerArtist,
  hasChords,
  isFavorited,
  isStemSelectionDisabled = false,
  chordNamesForMap,
  representativeStrumPattern,
  sectionStrumPatterns,
  onToggleFavorite,
  onTogglePlay,
  onEnterEditMode,
  onOpenTutorial,
  onSetStemVolume,
  stemVolumes,
  getRecordingTap,
}: PrimaryControlsProps) {
  const isEditMode = useChordEditStore((s) => s.isEditMode)
  const [showMetronome, setShowMetronome] = useState(false)

  return (
    <>
      <button
        type="button"
        onClick={onToggleFavorite}
        className={cn(
          'inline-flex h-20 w-full flex-col items-center justify-center gap-1 rounded-2xl',
          'border border-flame-400/25 bg-[#111215] shadow-[0_0_24px_rgba(250,204,21,0.13),0_12px_28px_rgba(0,0,0,0.34)]',
          'hover:border-flame-400/50 hover:bg-flame-400/15 transition-colors',
          'focus:outline-none focus:ring-2 focus:ring-flame-400/40 focus:ring-offset-1 focus:ring-offset-charcoal-800',
        )}
        data-tour="favorite"
        data-testid={`favorite-toggle-${songId}`}
        aria-label={isFavorited ? 'Remove from favorites' : 'Add to favorites'}
      >
        <Heart
          size={25}
          className={cn(
            'transition-colors',
            isFavorited ? 'fill-flame-300 text-flame-300 animate-favorite-ignite' : 'text-flame-300',
          )}
        />
        <span className="text-[11px] font-medium text-smoke-200">Heart</span>
      </button>
      <Suspense fallback={<div className="h-20 w-full rounded-2xl border border-white/10 bg-[#111215]" aria-hidden="true" />}>
        <RecordButton songTitle={headerTitle} artist={headerArtist} getRecordingTap={getRecordingTap} />
      </Suspense>
      <div className="contents" data-tour="chord-edit">
        {hasChords && !isEditMode && (
          <button
            type="button"
            onClick={onEnterEditMode}
            className={cn(
              'inline-flex h-20 w-full flex-col items-center justify-center gap-1 rounded-2xl',
              'border border-white/10 bg-[#111215] text-flame-300 shadow-[0_12px_28px_rgba(0,0,0,0.34)] backdrop-blur',
              'hover:border-flame-400/30 hover:text-flame-400 transition-colors',
              'focus:outline-none focus:ring-2 focus:ring-flame-400/40 focus:ring-offset-1 focus:ring-offset-charcoal-800',
            )}
            aria-label="Edit chords"
            data-testid="chord-edit-toggle"
          >
            <Pencil size={23} />
            <span className="text-[11px] font-medium text-smoke-200">Edit</span>
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
          bpm={detail.source_bpm ?? detail.rhythm?.bpm}
          strumNotes={detail.strum_notes}
          tutorialUrl={detail.tutorial_url}
          tutorialLinks={detail.tutorial_links}
          strumLoading={!detail.songsterr_status}
          iconOnly
          onOpenTutorial={onOpenTutorial}
        />
      </div>
      <div className="relative">
        <button
          type="button"
          onClick={() => setShowMetronome((value) => !value)}
          className={cn(
            'inline-flex h-20 w-full flex-col items-center justify-center gap-1 rounded-2xl',
            'border border-white/10 bg-[#111215] text-flame-300 shadow-[0_12px_28px_rgba(0,0,0,0.34)] backdrop-blur',
            'hover:border-flame-400/30 hover:text-flame-400 transition-colors',
            'focus:outline-none focus:ring-2 focus:ring-flame-400/40 focus:ring-offset-1 focus:ring-offset-charcoal-800',
            showMetronome && 'border-flame-400/40 text-flame-400 bg-flame-400/10',
          )}
          aria-label="Open metronome"
          data-testid="song-metronome-toggle"
        >
          <Timer size={23} aria-hidden="true" />
          <span className="text-[11px] font-medium text-smoke-200">Metro</span>
        </button>
        {showMetronome && (
          <MetronomePopup
            autoBpm={detail.source_bpm ?? detail.rhythm?.bpm ?? null}
            onTogglePlay={onTogglePlay}
            onClose={() => setShowMetronome(false)}
          />
        )}
      </div>
    </>
  )
}

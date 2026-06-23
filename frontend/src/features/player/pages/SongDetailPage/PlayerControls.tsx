import { useState } from 'react'
import { Heart, Pencil, Timer } from 'lucide-react'

import { LoadingSpinner } from '@/components/shared/LoadingSpinner'
import { MetronomePanel } from '@/features/metronome/components/MetronomePanel'
import { cn } from '@/lib/cn'
import { usePlaybackStore } from '@/stores/playback.store'
import type { LyricsSourceMode } from '@/stores/player-prefs.store'
import type { SongDetail, ChordOption } from '@/types/song'
import { useChordEditStore } from '@/stores/chord-edit.store'

import { ChordMapDialog } from '../../components/ChordMapDialog'
import { LyricsSourceSelector } from '../../components/LyricsSourceSelector'
import { LyricsSyncControl } from '../../components/LyricsSyncControl'
import { ChordDisplayControls } from '../../components/ChordDisplayControls'
import { CountInToggle } from '../../components/CountInToggle'
import { HighlightToggle } from '../../components/HighlightToggle'
import { PlaybackSpeedSelector } from '../../components/PlaybackSpeedSelector'
import { RecordButton } from '../../components/RecordButton'
import { ScrollModeControl } from '../../components/ScrollModeControl'
import { SheetSelector } from '../../components/SheetSelector'
import { TrackSelector } from '../../components/TrackSelector'
import { TransportControls } from '../../components/TransportControls'
import type { LyricsSourceOption } from '../../lib/lyrics-sources'
import type { StrumSymbol, SectionStrumPattern } from '../../lib/strum-pattern'

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
      className="flex items-center justify-center gap-2 rounded-lg border border-charcoal-700 bg-charcoal-900/40 px-3 py-2 text-sm text-smoke-300"
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
    <div className="flex flex-col gap-4" data-testid="player-controls">
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
  onEnterEditMode,
  onOpenTutorial,
  onSetStemVolume,
  stemVolumes,
  getRecordingTap,
}: PrimaryControlsProps) {
  const isEditMode = useChordEditStore((s) => s.isEditMode)
  const currentTime = usePlaybackStore((s) => s.currentTime)
  const isPlaying = usePlaybackStore((s) => s.isPlaying)
  const [showMetronome, setShowMetronome] = useState(false)

  return (
    <>
      <button
        type="button"
        onClick={onToggleFavorite}
        className={cn(
          'inline-flex items-center justify-center rounded-lg w-16 h-16',
          'bg-charcoal-700 border border-charcoal-600',
          'hover:border-flame-400/30 transition-colors',
          'focus:outline-none focus:ring-2 focus:ring-flame-400/40 focus:ring-offset-1 focus:ring-offset-charcoal-800',
        )}
        data-tour="favorite"
        data-testid={`favorite-toggle-${songId}`}
        aria-label={isFavorited ? 'Remove from favorites' : 'Add to favorites'}
      >
        <Heart
          size={28}
          className={cn(
            'transition-colors',
            isFavorited ? 'fill-flame-400 text-flame-400 animate-favorite-ignite' : 'text-flame-400/70',
          )}
        />
      </button>
      <RecordButton songTitle={headerTitle} artist={headerArtist} getRecordingTap={getRecordingTap} />
      <div className="contents" data-tour="chord-edit">
        {hasChords && !isEditMode && (
          <button
            type="button"
            onClick={onEnterEditMode}
            className={cn(
              'inline-flex items-center justify-center rounded-lg w-16 h-16',
              'bg-charcoal-700 border border-charcoal-600 text-flame-400/70',
              'hover:border-flame-400/30 hover:text-flame-400 transition-colors',
              'focus:outline-none focus:ring-2 focus:ring-flame-400/40 focus:ring-offset-1 focus:ring-offset-charcoal-800',
            )}
            aria-label="Edit chords"
            data-testid="chord-edit-toggle"
          >
            <Pencil size={24} />
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
            'inline-flex items-center justify-center rounded-lg w-16 h-16',
            'bg-charcoal-700 border border-charcoal-600 text-flame-400/70',
            'hover:border-flame-400/30 hover:text-flame-400 transition-colors',
            'focus:outline-none focus:ring-2 focus:ring-flame-400/40 focus:ring-offset-1 focus:ring-offset-charcoal-800',
            showMetronome && 'border-flame-400/40 text-flame-400 bg-flame-400/10',
          )}
          aria-label="Open metronome"
          data-testid="song-metronome-toggle"
        >
          <Timer size={25} aria-hidden="true" />
        </button>
        {showMetronome && (
          <div className="fixed inset-x-3 bottom-24 z-50 sm:absolute sm:bottom-auto sm:left-1/2 sm:top-20 sm:w-96 sm:-translate-x-1/2">
            <MetronomePanel
              autoBpm={detail.source_bpm ?? detail.rhythm?.bpm ?? null}
              mode="playback"
              playbackTime={currentTime}
              playbackPlaying={isPlaying}
              compact
            />
          </div>
        )}
      </div>
    </>
  )
}

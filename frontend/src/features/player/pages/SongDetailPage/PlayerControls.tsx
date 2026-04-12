import { useCallback } from 'react'
import { Heart, Pencil } from 'lucide-react'
import { LoadingSpinner } from '@/components/shared/LoadingSpinner'
import { usePlaybackStore } from '@/stores/playback.store'
import { usePlayerPrefsStore } from '@/stores/player-prefs.store'
import { useChordEditStore } from '@/stores/chord-edit.store'
import { TransportControls } from '../../components/TransportControls'
import { TrackSelector } from '../../components/TrackSelector'
import { ChordOptionSelector } from '../../components/ChordOptionSelector'
import { ChordDisplayControls } from '../../components/ChordDisplayControls'
import { PlaybackSpeedSelector } from '../../components/PlaybackSpeedSelector'
import { LyricsSyncControl } from '../../components/LyricsSyncControl'
import { ScrollModeControl } from '../../components/ScrollModeControl'
import { ChordVersionToggle } from '../../components/ChordVersionToggle'
import { ChordMapDialog } from '../../components/ChordMapDialog'
import { RecordButton } from '../../components/RecordButton'
import { cn } from '@/lib/cn'
import type { SongDetail, ChordOption } from '@/types/song'
import type { StrumSymbol, SectionStrumPattern } from '../../lib/strum-pattern'

interface PlayerControlsProps {
  songId: string
  detail: SongDetail
  headerTitle: string
  headerArtist: string
  hasChords: boolean
  hasTabs: boolean
  isFavorited: boolean
  showAudioStatus: boolean
  audioStatusMessage?: string
  allVersions: ChordOption[]
  activeChords: { chord: string; start_time: number; end_time: number }[]
  selectedVersionIndex: number
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
  onDeleteChords: () => void
  onOpenTutorial: () => void
}

interface AudioStatusBannerProps {
  message?: string
}

function AudioStatusBanner({ message }: AudioStatusBannerProps) {
  const activeStems = usePlaybackStore((s) => s.activeStems)
  const isFullSong = usePlaybackStore((s) => s.isFullSong)

  const fallbackMessage = isFullSong
    ? 'Downloading audio...'
    : `Preparing ${activeStems.map((s) => s.replaceAll('_', ' ')).join(', ')}...`

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
 * Renders the transport controls with primary action buttons (favorite, edit, stems, version)
 * and secondary controls (chord options, display, speed, lyrics sync, scroll mode).
 */
export function PlayerControls({
  songId,
  detail,
  headerTitle,
  headerArtist,
  hasChords,
  hasTabs,
  isFavorited,
  showAudioStatus,
  audioStatusMessage,
  allVersions,
  activeChords,
  selectedVersionIndex,
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
  onDeleteChords,
  onOpenTutorial,
}: PlayerControlsProps) {
  return (
    <div className="flex flex-col gap-4" data-testid="player-controls">
      {showAudioStatus && <AudioStatusBanner message={audioStatusMessage} />}
      <TransportControls
        onTogglePlay={onTogglePlay}
        onSeek={onSeek}
        primaryControls={
          <PrimaryControls
            songId={songId}
            detail={detail}
            headerTitle={headerTitle}
            headerArtist={headerArtist}
            hasChords={hasChords}
            isFavorited={isFavorited}
            allVersions={allVersions}
            selectedVersionIndex={selectedVersionIndex}
            chordNamesForMap={chordNamesForMap}
            representativeStrumPattern={representativeStrumPattern}
            sectionStrumPatterns={sectionStrumPatterns}
            userEmail={userEmail}
            chordsUpgrading={chordsUpgrading}
            onToggleFavorite={onToggleFavorite}
            onEnterEditMode={onEnterEditMode}
            onSetVersionIndex={onSetVersionIndex}
            onDeleteChords={onDeleteChords}
            onOpenTutorial={onOpenTutorial}
          />
        }
        secondaryControls={
          <>
            <ChordOptionSelector
              activeChords={activeChords}
              hasTabs={hasTabs}
            />
            <ChordDisplayControls />
            <PlaybackSpeedSelector />
            <LyricsSyncControl />
            <ScrollModeControl />
          </>
        }
      />
    </div>
  )
}

// --- Primary controls (extracted to keep PlayerControls render concise) ---

interface PrimaryControlsProps {
  songId: string
  detail: SongDetail
  headerTitle: string
  headerArtist: string
  hasChords: boolean
  isFavorited: boolean
  allVersions: ChordOption[]
  selectedVersionIndex: number
  chordNamesForMap: string[]
  representativeStrumPattern: StrumSymbol[]
  sectionStrumPatterns: SectionStrumPattern[]
  userEmail: string | null
  chordsUpgrading: boolean
  onToggleFavorite: () => void
  onEnterEditMode: () => void
  onSetVersionIndex: (idx: number) => void
  onDeleteChords: () => void
  onOpenTutorial: () => void
}

function PrimaryControls({
  songId,
  detail,
  headerTitle,
  headerArtist,
  hasChords,
  isFavorited,
  allVersions,
  selectedVersionIndex,
  chordNamesForMap,
  representativeStrumPattern,
  sectionStrumPatterns,
  userEmail,
  chordsUpgrading,
  onToggleFavorite,
  onEnterEditMode,
  onSetVersionIndex,
  onDeleteChords,
  onOpenTutorial,
}: PrimaryControlsProps) {
  const activeStems = usePlaybackStore((s) => s.activeStems)
  const isFullSong = usePlaybackStore((s) => s.isFullSong)
  const toggleStem = usePlaybackStore((s) => s.toggleStem)
  const selectFullSong = usePlaybackStore((s) => s.selectFullSong)
  const setSongOverride = usePlayerPrefsStore((s) => s.setSongOverride)
  const isEditMode = useChordEditStore((s) => s.isEditMode)

  const handleToggleStem = useCallback((stem: string) => {
    toggleStem(stem)
    const { activeStems: newStems, isFullSong: nowFull } = usePlaybackStore.getState()
    setSongOverride(songId, 'activeStems', nowFull ? 'fullSong' : newStems)
  }, [songId, toggleStem, setSongOverride])

  const handleSelectFullSong = useCallback(() => {
    selectFullSong()
    setSongOverride(songId, 'activeStems', 'fullSong')
  }, [songId, selectFullSong, setSongOverride])

  return (
    <>
      <button
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
            isFavorited ? 'fill-flame-400 text-flame-400 animate-favorite-ignite' : 'text-flame-400/70'
          )}
        />
      </button>
      <RecordButton songTitle={headerTitle} artist={headerArtist} />
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
          activeStems={activeStems}
          isFullSong={isFullSong}
          onToggleStem={handleToggleStem}
          onSelectFullSong={handleSelectFullSong}
          availableStems={detail.stems}
          stemTypes={detail.stem_types}
        />
      </div>
      <div className="contents" data-tour="version-toggle">
        <ChordVersionToggle
          versions={allVersions}
          selectedIndex={selectedVersionIndex}
          currentUserEmail={userEmail ?? undefined}
          upgrading={chordsUpgrading}
          onSelect={onSetVersionIndex}
          onDelete={onDeleteChords}
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
    </>
  )
}

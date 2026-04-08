import { useParams } from 'react-router-dom'
import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useSongDetail } from '../../hooks/use-song-detail'
import { useAudioPlayer } from '../../hooks/use-audio-player'
import { useWakeLock } from '../../hooks/use-wake-lock'
import { useLyricsSync } from '../../hooks/use-lyrics-sync'
import { normalizeWords } from '../../lib/normalize-words'
import { getRepresentativeSongStrumPattern, getSectionStrumPatterns } from '../../lib/strum-pattern'
import { OnboardingTour } from '../../components/OnboardingTour'
import { LyricsSyncDebug } from '../../components/LyricsSyncDebug'
import { useRotatingText } from '@/features/search/hooks/use-rotating-text'
import { LoadingSpinner } from '@/components/shared/LoadingSpinner'
import { usePlaybackStore } from '@/stores/playback.store'
import { usePlayerPrefsStore } from '@/stores/player-prefs.store'
import { useSubscriptionStore } from '@/stores/subscription.store'
import { useSongMediaCacheStore } from '@/stores/song-media-cache.store'
import { useToggleFavorite } from '@/features/library/hooks/use-toggle-favorite'
import { useFavorites } from '@/features/library/hooks/use-favorites'
import { useJobWatcherStore } from '@/stores/job-watcher.store'
import { env } from '@/config/env'
import { songsApi } from '@/api/songs.api'
import { useAuthStore } from '@/stores/auth.store'
import { useChordEditStore } from '@/stores/chord-edit.store'
import { useSaveChords } from '../../hooks/use-save-chords'
import { useDeleteChords } from '../../hooks/use-delete-chords'
import { trackCustomEvent } from '@/lib/meta-pixel'
import { displayArtistName, displaySongTitle, getThumbnailUrl } from '@/lib/format-song'
import { transposeChordLabel } from '@/lib/chord-utils'
import { simplifyChords, transposeForCapo } from '@/lib/chord-simplifier'
import { SongHeader } from './SongHeader'
import { PlayerControls } from './PlayerControls'
import { SongContent } from './SongContent'
import { RecommendedSongs } from '../../components/RecommendedSongs'
import { TutorialOverlay } from './TutorialOverlay'

function getAudioUrl(
  songId: string,
  stem: string,
  detail: { audio_url: string | null; stems: Record<string, string | null> },
): string | null {
  if (env.isLocal) {
    const stemName = stem === 'full_mix' ? 'audio' : stem
    return `${env.apiBaseUrl}/api/v1/songs/${songId}/stream?stem=${stemName}`
  }
  if (stem === 'full_mix') return detail.audio_url
  return detail.stems[stem] || null
}

/**
 * Main page for viewing and playing a song. Composes the song header,
 * player controls, chord/lyrics/tabs content, and tutorial overlay.
 */
export function SongDetailPage() {
  const { songId } = useParams<{ songId: string }>()
  const { loadStems, loadFullSong, togglePlay, seek } = useAudioPlayer()
  const hasRecordedPlayRef = useRef(false)
  const activeStems = usePlaybackStore((s) => s.activeStems)
  const isFullSong = usePlaybackStore((s) => s.isFullSong)
  const setActiveStems = usePlaybackStore((s) => s.setActiveStems)
  const selectFullSong = usePlaybackStore((s) => s.selectFullSong)
  const setCurrentSong = usePlaybackStore((s) => s.setCurrentSong)
  const selectedChordOptionIndex = usePlaybackStore((s) => s.selectedChordOptionIndex)
  const isPlaying = usePlaybackStore((s) => s.isPlaying)
  useWakeLock(isPlaying)
  const { data: detail, isLoading } = useSongDetail(songId!, { pollForTabs: true })
  const { data: favorites } = useFavorites()
  const { add: addFav, remove: removeFav } = useToggleFavorite()
  const globalTranspose = usePlayerPrefsStore((s) => s.transposeSemitones)
  const globalLyricsOffset = usePlayerPrefsStore((s) => s.lyricsOffsetMs)
  const globalStrumSource = usePlayerPrefsStore((s) => s.strumSource)
  const songOverrides = usePlayerPrefsStore((s) => s.songOverrides[songId!])
  const setSongOverride = usePlayerPrefsStore((s) => s.setSongOverride)

  // Chord editing
  const enterEditMode = useChordEditStore((s) => s.enterEditMode)
  const editingChords = useChordEditStore((s) => s.editingChords)
  const editingLyrics = useChordEditStore((s) => s.editingLyrics)
  const isEditMode = useChordEditStore((s) => s.isEditMode)
  const addChordAtTime = useChordEditStore((s) => s.addChordAtTime)
  const saveChordsMutation = useSaveChords()
  const deleteChordsMutation = useDeleteChords()
  const userEmail = useAuthStore((s) => s.email)

  // Per-song values with global fallback
  const selectedVersionIndex = songOverrides?.selectedVersionIndex ?? 0
  const transposeSemitones = songOverrides?.transposeSemitones ?? globalTranspose
  const lyricsOffsetMs = songOverrides?.lyricsOffsetMs ?? globalLyricsOffset
  const strumSource = songOverrides?.strumSource ?? globalStrumSource

  // Sync per-song effective values into global store
  const setGlobalTranspose = usePlayerPrefsStore((s) => s.setTransposeSemitones)
  const setGlobalLyricsOffset = usePlayerPrefsStore((s) => s.setLyricsOffsetMs)
  const setGlobalStrumSource = usePlayerPrefsStore((s) => s.setStrumSource)

  useEffect(() => { setGlobalTranspose(transposeSemitones) }, [transposeSemitones, setGlobalTranspose])
  useEffect(() => { setGlobalLyricsOffset(lyricsOffsetMs) }, [lyricsOffsetMs, setGlobalLyricsOffset])
  useEffect(() => { setGlobalStrumSource(strumSource) }, [strumSource, setGlobalStrumSource])

  const [showTutorial, setShowTutorial] = useState(false)
  const isAdmin = useSubscriptionStore((s) => s.status?.is_admin) ?? false

  const isFavorited = favorites?.some((f) => f.song_id === songId) || false
  const loadingLabel = useRotatingText(
    ['Fetching the music...', 'Getting it...', 'Almost there...'],
    isLoading || !detail,
  )
  const addViewingSong = useJobWatcherStore((s) => s.addViewingSong)
  const removeViewingSong = useJobWatcherStore((s) => s.removeViewingSong)

  const hasStemsProcessed = detail?.stem_types.some(({ name }) => !!detail.stems[name]) ?? false

  useEffect(() => {
    if (!songId) return
    hasRecordedPlayRef.current = false
    setCurrentSong(songId)

    const prefs = usePlayerPrefsStore.getState()
    const overrides = prefs.songOverrides[songId]

    if (overrides?.activeStems !== undefined) {
      if (overrides.activeStems === 'fullSong') {
        selectFullSong()
      } else {
        setActiveStems(overrides.activeStems)
      }
    } else if (prefs.defaultStems.length > 0) {
      setActiveStems(prefs.defaultStems)
    }

    // Restore per-song playback rate
    if (overrides?.playbackRate !== undefined) {
      usePlaybackStore.getState().setPlaybackRate(overrides.playbackRate)
    }

    // Restore per-song chord display mode + capo fret
    if (overrides?.chordDisplayMode !== undefined) {
      usePlaybackStore.getState().setChordDisplayMode(
        overrides.chordDisplayMode,
        overrides.chordCapoFret ?? 0,
      )
    }

    // Restore per-song sheet mode (chords vs tabs)
    if (overrides?.sheetMode !== undefined) {
      usePlaybackStore.getState().setSheetMode(overrides.sheetMode)
    }
  }, [songId, setCurrentSong, setActiveStems, selectFullSong])

  useEffect(() => {
    if (!songId) return
    addViewingSong(songId)
    return () => removeViewingSong(songId)
  }, [songId, addViewingSong, removeViewingSong])

  // Load audio when stems or full-song mode changes.
  useEffect(() => {
    if (!detail || !songId) return
    if (isFullSong) {
      const url = getAudioUrl(songId, 'full_mix', detail)
      if (url) loadFullSong(url)
    } else if (activeStems.length > 0) {
      const urls = new Map<string, string>()
      for (const stem of activeStems) {
        const url = getAudioUrl(songId, stem, detail)
        if (url) urls.set(stem, url)
      }
      if (urls.size > 0) loadStems(urls)
    }
  }, [detail, songId, isFullSong, activeStems, loadStems, loadFullSong])

  // If the backend no longer offers a selected stem, remove it from activeStems.
  useEffect(() => {
    if (!detail || isFullSong) return
    const offered = new Set(detail.stem_types.map((s) => s.name))
    const valid = activeStems.filter((s) => offered.has(s))
    if (valid.length !== activeStems.length) {
      if (valid.length === 0) {
        selectFullSong()
      } else {
        setActiveStems(valid)
      }
    }
  }, [detail, isFullSong, activeStems, setActiveStems, selectFullSong])

  const handleTogglePlay = useCallback(() => {
    if (songId && !isPlaying && !hasRecordedPlayRef.current) {
      hasRecordedPlayRef.current = true
      trackCustomEvent('PlaySong', { song_id: songId })
      void songsApi.recordPlay(songId).catch(() => {
        hasRecordedPlayRef.current = false
      })
    }
    togglePlay()
  }, [isPlaying, songId, togglePlay])

  const handleToggleFavorite = () => {
    if (!songId) return
    if (isFavorited) {
      removeFav.mutate(songId)
    } else {
      addFav.mutate(songId)
    }
  }

  // --- Unified version system ---
  const allVersions = useMemo(
    () => (detail?.chord_options ?? []).filter((o) => !o.hidden && !o.is_variant),
    [detail?.chord_options],
  )

  const variantOptions = useMemo(
    () => (detail?.chord_options ?? []).filter((o) => o.is_variant),
    [detail?.chord_options],
  )

  const activeVersion = allVersions[selectedVersionIndex] ?? allVersions[0]
  const baseChords = useMemo(() => activeVersion?.chords ?? [], [activeVersion])

  const activeChords = useMemo(() => {
    if (!detail) return []
    if (selectedChordOptionIndex !== null && variantOptions[selectedChordOptionIndex]) {
      return variantOptions[selectedChordOptionIndex].chords
    }
    return baseChords
  }, [detail, selectedChordOptionIndex, variantOptions, baseChords])

  const chordDisplayMode = usePlaybackStore((s) => s.chordDisplayMode)
  const chordCapoFret = usePlaybackStore((s) => s.chordCapoFret)

  const displayChords = useMemo(() => {
    if (activeChords.length === 0) return activeChords
    let chords = activeChords
    if (chordDisplayMode === 'beginner') {
      chords = simplifyChords(chords)
    } else if (chordDisplayMode === 'capo' && chordCapoFret > 0) {
      chords = transposeForCapo(chords, chordCapoFret)
    }
    return chords.map((c) => ({
      ...c,
      chord: transposeChordLabel(c.chord, transposeSemitones, { preferSharps: true }),
    }))
  }, [activeChords, transposeSemitones, chordDisplayMode, chordCapoFret])

  const chordNamesForMap = useMemo(() => {
    const source = isEditMode ? editingChords : displayChords
    return source.map((c) => c.chord).filter(Boolean)
  }, [isEditMode, editingChords, displayChords])

  const representativeStrumPattern = useMemo(() => {
    if (!detail) return []
    return getRepresentativeSongStrumPattern(displayChords, detail.strums, {
      rhythm: detail.rhythm,
      maxSymbols: 8,
    })
  }, [detail, displayChords])

  const sectionStrumPatterns = useMemo(() => {
    if (!detail || !detail.sections?.length) return []
    return getSectionStrumPatterns(detail.sections)
  }, [detail])

  // --- Lyrics sync debug overlay (Ctrl+Shift+D) ---
  const [showLyricsDebug, setShowLyricsDebug] = useState(
    () => typeof window !== 'undefined' && localStorage.getItem('lyrics-debug-enabled') === 'true',
  )

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'D') {
        e.preventDefault()
        setShowLyricsDebug((prev) => {
          const next = !prev
          localStorage.setItem('lyrics-debug-enabled', String(next))
          return next
        })
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  const activeLyrics = useMemo(() => activeVersion?.lyrics ?? [], [activeVersion])
  const activeLyricsSource = activeVersion?.lyrics_source ?? null

  const debugNormalizedSegments = useMemo(
    () => activeLyrics.map((s) => ({ ...s, words: normalizeWords(s) })),
    [activeLyrics],
  )
  const debugSync = useLyricsSync(debugNormalizedSegments)

  const markThumbnailFailed = useSongMediaCacheStore((s) => s.markThumbnailFailed)
  const setThumbnailIfMissing = useSongMediaCacheStore((s) => s.setThumbnailIfMissing)

  const thumbFailed = useSongMediaCacheStore(
    (s) => (songId ? s.thumbnailFailedBySongId[songId] : false) ?? false
  )
  const cachedThumbnail = useSongMediaCacheStore(
    (s) => (songId ? s.thumbnailBySongId[songId] : undefined)
  )

  useEffect(() => {
    if (!detail || !songId) return
    if (thumbFailed) return
    const url = getThumbnailUrl({ id: songId, thumbnail_url: detail.thumbnail_url })
    if (url) setThumbnailIfMissing(songId, url)
  }, [detail, songId, thumbFailed, setThumbnailIfMissing])

  const thumbnailSrc = (!thumbFailed ? cachedThumbnail : null) ?? '/art/album-placeholder.png'

  const hasAnyLyrics = activeLyrics.length > 0
  const hasTabs = (detail?.tabs?.length ?? 0) > 0 || (detail?.strums?.length ?? 0) > 0 || !!detail?.rhythm

  const handleEnterEditMode = useCallback(() => {
    if (!activeChords.length) return
    enterEditMode(activeChords, activeLyrics)
  }, [activeChords, activeLyrics, enterEditMode])

  const handleSaveChords = useCallback(() => {
    if (!songId) return
    saveChordsMutation.mutate({
      songId,
      name: 'Custom',
      chords: editingChords,
      lyrics: editingLyrics,
    })
  }, [songId, editingChords, editingLyrics, saveChordsMutation])

  const handleAddChordAtWord = useCallback(
    (startTime: number) => {
      addChordAtTime('Am', startTime)
    },
    [addChordAtTime]
  )

  // --- Loading state ---
  if (isLoading || !detail) {
    return (
      <LoadingSpinner size="lg" label={loadingLabel} className="flex-1 min-h-screen" />
    )
  }

  const audioUrl = isFullSong
    ? getAudioUrl(songId!, 'full_mix', detail)
    : activeStems.length > 0
      ? getAudioUrl(songId!, activeStems[0], detail)
      : null
  const hasChords = activeChords.length > 0
  const chordsLoading = !hasChords && !detail?.chord_source && hasStemsProcessed
  const chordsUpgrading = hasChords && detail?.chord_source === 'autochord' && !detail?.web_chords_failed
  const showAudioStatus = !audioUrl && hasStemsProcessed

  const headerTitle = displaySongTitle(detail.song)
  const headerArtist = displayArtistName(detail.song)

  return (
    <div className="relative h-full flex flex-col overflow-hidden pb-16 lg:pb-0" data-testid="song-detail-page">
      {/* Background Image */}
      <div className="fixed inset-0 pointer-events-none">
        <div
          className="artwork-backdrop-feather absolute inset-0 bg-cover bg-center bg-no-repeat opacity-30 blur-3xl scale-125"
          style={{ backgroundImage: `url("${thumbnailSrc}")` }}
        />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_18%,rgba(10,10,10,0.22)_58%,rgba(10,10,10,0.72)_100%)]" />
      </div>

      {/* Fixed top section: song header + player controls */}
      <div className="relative z-30 shrink-0 bg-black border-b border-charcoal-800/50">
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div
            className="artwork-backdrop-feather absolute inset-0 bg-cover bg-center bg-no-repeat opacity-30 blur-2xl scale-125"
            style={{ backgroundImage: `url("${thumbnailSrc}")` }}
          />
          <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(10,10,10,0.2)_0%,rgba(10,10,10,0.45)_55%,rgba(10,10,10,0.7)_100%)]" />
        </div>
        <div className="relative max-w-7xl mx-auto p-3 pb-2 sm:p-4 sm:pb-3 flex flex-col gap-3 sm:gap-4">
          <SongHeader
            songId={songId!}
            title={headerTitle}
            artist={headerArtist}
            thumbnailSrc={thumbnailSrc}
            isAdmin={isAdmin}
            isPlaying={isPlaying}
            onTogglePlay={handleTogglePlay}
            onSeek={seek}
            onThumbnailError={() => songId && markThumbnailFailed(songId)}
          />

          <PlayerControls
            songId={songId!}
            detail={detail}
            headerTitle={headerTitle}
            headerArtist={headerArtist}
            hasChords={hasChords}
            hasTabs={hasTabs}
            isFavorited={isFavorited}
            showAudioStatus={showAudioStatus}
            allVersions={allVersions}
            activeChords={activeChords}
            selectedVersionIndex={selectedVersionIndex}
            chordNamesForMap={chordNamesForMap}
            representativeStrumPattern={representativeStrumPattern}
            sectionStrumPatterns={sectionStrumPatterns}
            userEmail={userEmail}
            chordsUpgrading={chordsUpgrading}
            onTogglePlay={handleTogglePlay}
            onSeek={seek}
            onToggleFavorite={handleToggleFavorite}
            onEnterEditMode={handleEnterEditMode}
            onSetVersionIndex={(idx: number) => setSongOverride(songId!, 'selectedVersionIndex', idx)}
            onDeleteChords={() => {
              if (songId && confirm('Delete your chord version?')) {
                deleteChordsMutation.mutate({ songId })
              }
            }}
            onOpenTutorial={() => setShowTutorial(true)}
          />
        </div>
      </div>

      {/* Content */}
      <SongContent
        songId={songId!}
        detail={detail}
        headerTitle={headerTitle}
        headerArtist={headerArtist}
        hasStemsProcessed={hasStemsProcessed}
        hasChords={hasChords}
        hasAnyLyrics={hasAnyLyrics}
        hasTabs={hasTabs}
        displayChords={displayChords}
        activeLyrics={activeLyrics}
        chordNamesForMap={chordNamesForMap}
        representativeStrumPattern={representativeStrumPattern}
        sectionStrumPatterns={sectionStrumPatterns}
        chordsLoading={chordsLoading}
        onSeek={seek}
        onSaveChords={handleSaveChords}
        isSavingChords={saveChordsMutation.isPending}
        onAddChordAtWord={handleAddChordAtWord}
        onOpenTutorial={() => setShowTutorial(true)}
      />

      {/* Recommendations — hidden during playback to give more space to chords/lyrics */}
      {!isPlaying && <RecommendedSongs songId={songId!} />}

      {/* Floating YouTube tutorial */}
      {showTutorial && (
        <TutorialOverlay
          tutorialUrl={detail.tutorial_url}
          tutorialLinks={detail.tutorial_links}
          onClose={() => setShowTutorial(false)}
        />
      )}

      <OnboardingTour />

      {showLyricsDebug && hasAnyLyrics && (
        <LyricsSyncDebug
          segments={debugNormalizedSegments}
          activeSegmentIndex={debugSync.activeSegmentIndex}
          activeWordIndex={debugSync.activeWordIndex}
          lyricsSource={activeLyricsSource}
        />
      )}
    </div>
  )
}

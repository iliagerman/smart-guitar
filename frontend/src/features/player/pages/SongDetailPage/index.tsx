import { useMutation } from '@tanstack/react-query'
import { useParams } from 'react-router-dom'
import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { toast } from 'sonner'
import { useSongDetail } from '../../hooks/use-song-detail'
import { useAudioPlayer } from '../../hooks/use-audio-player'
import { useWakeLock } from '../../hooks/use-wake-lock'
import { useLyricsSync } from '../../hooks/use-lyrics-sync'
import { useCountIn } from '../../hooks/use-count-in'
import { CountInOverlay } from '../../components/CountInOverlay'
import { resumeTickContext } from '../../lib/count-in-audio'
import { formatChordWithBass } from '@/lib/chord-colors'
import { normalizeWords } from '../../lib/normalize-words'
import { getRepresentativeSongStrumPattern, getTabStrumPatterns } from '../../lib/strum-pattern'
import { LyricsSyncDebug } from '../../components/LyricsSyncDebug'
import { useRotatingText } from '@/features/search/hooks/use-rotating-text'
import { BlockingErrorState } from '@/components/shared/BlockingErrorState'
import { LoadingSpinner } from '@/components/shared/LoadingSpinner'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { beatIndexAt, songBeatTimes, songTempoBpm } from '@/features/metronome/lib/song-beat-grid'
import { usePlaybackStore } from '@/stores/playback.store'
import { usePlayerPrefsStore } from '@/stores/player-prefs.store'
import { useSubscriptionStore } from '@/stores/subscription.store'
import { useSongMediaCacheStore } from '@/stores/song-media-cache.store'
import { useToggleFavorite } from '@/features/library/hooks/use-toggle-favorite'
import { useFavorites } from '@/features/library/hooks/use-favorites'
import { useJobWatcherStore } from '@/stores/job-watcher.store'
import { env } from '@/config/env'
import { songsApi } from '@/api/songs.api'
import { queryClient } from '@/config/query-client'
import { queryKeys } from '@/api/query-keys'
import { useAuthStore } from '@/stores/auth.store'
import { useChordEditStore } from '@/stores/chord-edit.store'
import { useSaveChords } from '../../hooks/use-save-chords'
import { useDeleteChords } from '../../hooks/use-delete-chords'
import { trackCustomEvent } from '@/lib/meta-pixel'
import { displayArtistName, displaySongTitle, getThumbnailUrl } from '@/lib/format-song'
import { transposeChordLabel } from '@/lib/chord-utils'
import { simplifyChords, transposeForCapo } from '@/lib/chord-simplifier'
import { SongHeader } from './SongHeader'
import { AudioStatusBanner, FocusToggles, PlayerControls, PlayerTools, SheetPickers } from './PlayerControls'
import { SongContent } from './SongContent'
import { SongFinishedDialog } from '../../components/SongFinishedDialog'
import { TutorialOverlay } from './TutorialOverlay'
import { SongStage } from './SongStage'
import { SheetSourceTabs } from '../../components/SheetSourceTabs'
import { Collapse } from '@/components/shared/Collapse'
import { cn } from '@/lib/cn'
import { useMediaQuery } from '@/hooks/use-media-query'
import { useSongViewStore } from '@/stores/song-view.store'
import { useProAccess } from '@/features/subscription/hooks/use-pro-access'
import { getAvailableLyricsSources } from '../../lib/lyrics-sources'
import { musicStartTime } from '../../lib/music-start'
import { TourBackdrop } from '@/features/songs/components/tour/TourBackdrop'
import type { SceneKind } from '@/features/songs/components/tour/tour-worlds'
import {
  buildSheetVersions,
  getSheetVersionPreferenceKey,
  lyricsModeForActiveVersion,
} from '../../lib/sheet-versions'
import type { LyricsSegment } from '@/types/song'

function getAudioUrl(
  songId: string,
  stem: string,
  detail: { audio_url: string | null; stems: Record<string, string | null> },
): string | null {
  if (env.isLocal) {
    if (stem === 'full_mix') {
      return detail.audio_url ? `${env.apiBaseUrl}/api/v1/songs/${songId}/stream?stem=audio` : null
    }
    if (!detail.stems[stem]) return null
    return `${env.apiBaseUrl}/api/v1/songs/${songId}/stream?stem=${stem}`
  }
  if (stem === 'full_mix') return detail.audio_url
  return detail.stems[stem] || null
}

/**
 * A stem for multi-stem playback: its lighter mixer copy when it has one. The
 * player downloads and decodes every selected stem before playing, so size
 * is the wait; single-stem playback streams the full-quality file instead.
 */
function getMixerUrl(
  songId: string,
  stem: string,
  detail: { audio_url: string | null; stems: Record<string, string | null>; mixer_stems?: Record<string, string | null> },
): string | null {
  if (env.isLocal) return getAudioUrl(songId, stem, detail)
  return detail.mixer_stems?.[stem] || getAudioUrl(songId, stem, detail)
}

/** The song page sits backstage: just the follow-spots, no other worlds mounted. */
const STAGE_SCENES: readonly SceneKind[] = ['backstage']

function formatStemList(stems: string[]): string {
  return stems.map((stem) => stem.replaceAll('_', ' ')).join(', ')
}

interface BeatGlowProps {
  beatTimes: number[] | null
  bpm: number
}

/**
 * Full-screen glow pulse keyed to the current beat. Isolated so its
 * per-beat store subscription doesn't re-render the whole page — the
 * selector returns the beat number, so this only re-renders once per beat
 * instead of on every playback time tick.
 */
function BeatGlow({ beatTimes, bpm }: BeatGlowProps) {
  // Follows the recording's detected beats; a fixed tempo only when none were detected.
  const beatNumber = usePlaybackStore((s) => (
    beatTimes ? beatIndexAt(beatTimes, s.currentTime) : Math.floor(s.currentTime / (60 / bpm))
  ))
  if (beatNumber === null) return null
  return <div key={beatNumber} className="pointer-events-none absolute inset-0 z-20 animate-beat-screen-glow" />
}

interface LyricsDebugOverlayProps {
  lyrics: LyricsSegment[]
  lyricsSource: string | null
}

/**
 * Lyrics-sync debug overlay (Ctrl+Shift+D). Owns the word normalization and
 * the per-tick sync computation so that work only runs while the overlay is
 * actually mounted.
 */
function LyricsDebugOverlay({ lyrics, lyricsSource }: LyricsDebugOverlayProps) {
  const segments = useMemo(() => lyrics.map((s) => ({ ...s, words: normalizeWords(s) })), [lyrics])
  const sync = useLyricsSync(segments)
  return (
    <LyricsSyncDebug
      segments={segments}
      activeSegmentIndex={sync.activeSegmentIndex}
      activeWordIndex={sync.activeWordIndex}
      lyricsSource={lyricsSource}
    />
  )
}

/**
 * Main page for viewing and playing a song. Composes the song header,
 * player controls, chord/lyrics/tabs content, and tutorial overlay.
 */
// Composition root that coordinates tightly-coupled playback, editing and processing
// state; the view is already decomposed into SongHeader / PlayerControls / SongContent /
// TutorialOverlay, and further splitting the orchestration would scatter shared state.
// oxlint-disable-next-line react-doctor/no-giant-component
export function SongDetailPage() {
  const { songId } = useParams<{ songId: string }>()
  const lastPlaybackPopupRef = useRef<{ message: string; time: number } | null>(null)
  const showPlaybackErrorPopup = useCallback((message: string) => {
    const now = Date.now()
    const lastPopup = lastPlaybackPopupRef.current
    if (lastPopup && lastPopup.message === message && now - lastPopup.time < 2500) {
      return
    }
    lastPlaybackPopupRef.current = { message, time: now }
    console.error('Playback error:', message)
    toast.error('Playback failed — try reloading the page or switching track version.')
  }, [])
  const showInstrumentalSkipToast = useCallback(() => {
    toast.info('Skipped instrumental')
  }, [])
  const {
    clear,
    loadStems,
    getRecordingTap,
    loadFullSong,
    togglePlay,
    seek,
    setStemVolume,
    isLoading: isLoadingStemAudio,
    loadProgress: stemLoadProgress,
    prepareForPlaybackGesture,
    primeForDelayedStart,
    setInstrumentalGapSegments,
  } = useAudioPlayer({
    onPlaybackError: showPlaybackErrorPopup,
    onInstrumentalSkip: showInstrumentalSkipToast,
  })
  const countInEnabled = usePlayerPrefsStore((s) => s.countInEnabled)
  const { count: countInValue, isCounting, start: startCountIn, cancel: cancelCountIn, skip: skipCountIn } = useCountIn()
  const hasRecordedPlayRef = useRef(false)
  const activeStems = usePlaybackStore((s) => s.activeStems)
  const currentSongId = usePlaybackStore((s) => s.currentSongId)
  const isFullSong = usePlaybackStore((s) => s.isFullSong)
  const setActiveStems = usePlaybackStore((s) => s.setActiveStems)
  const selectFullSong = usePlaybackStore((s) => s.selectFullSong)
  const setCurrentSong = usePlaybackStore((s) => s.setCurrentSong)
  const selectedChordOptionIndex = usePlaybackStore((s) => s.selectedChordOptionIndex)
  const isPlaying = usePlaybackStore((s) => s.isPlaying)
  const hasPlaybackOccurred = usePlaybackStore((s) => s.hasPlaybackOccurred)
  // Within a second of the end (an ended song parks at its duration).
  const atSongEnd = usePlaybackStore((s) => s.currentTime >= s.duration - 1)
  // Playing the song again after it reached the end is another play.
  useEffect(() => {
    if (atSongEnd) hasRecordedPlayRef.current = false
  }, [atSongEnd])
  // The end-of-song card, once closed, stays closed until the song plays again.
  const [finishClosed, setFinishClosed] = useState(false)
  useWakeLock(isPlaying)
  const {
    data: detail,
    error: songDetailError,
    isError: isSongDetailError,
    isLoading,
    refetch: refetchSongDetail,
  } = useSongDetail(songId!, { pollForTabs: true })
  const { data: favorites } = useFavorites()
  const { add: addFav, remove: removeFav } = useToggleFavorite()
  const globalTranspose = usePlayerPrefsStore((s) => s.transposeSemitones)
  const globalStrumSource = usePlayerPrefsStore((s) => s.strumSource)
  const showBassNotes = usePlayerPrefsStore((s) => s.showBassNotes)
  const songOverrides = usePlayerPrefsStore((s) => s.songOverrides[songId!])
  const setSongOverride = usePlayerPrefsStore((s) => s.setSongOverride)

  // Chord editing
  const enterEditMode = useChordEditStore((s) => s.enterEditMode)
  const editingChords = useChordEditStore((s) => s.editingChords)
  const editingLyrics = useChordEditStore((s) => s.editingLyrics)
  const isEditMode = useChordEditStore((s) => s.isEditMode)
  const addChordAtTime = useChordEditStore((s) => s.addChordAtTime)

  // Playing on a phone or tablet: the sheet takes the screen (tools, band and
  // app nav step aside) until the song pauses.
  const isWide = useMediaQuery('(min-width: 1024px)')
  const focusMode = isPlaying && !isWide && !isEditMode
  const setImmersive = useSongViewStore((s) => s.setImmersive)
  useEffect(() => {
    setImmersive(focusMode)
  }, [focusMode, setImmersive])
  useEffect(() => () => {
    setImmersive(false)
    useSongViewStore.getState().setMetronomeOpen(false)
  }, [setImmersive])
  const saveChordsMutation = useSaveChords()
  const deleteChordsMutation = useDeleteChords()
  const userEmail = useAuthStore((s) => s.email)

  // Per-song values with global fallback
  const selectedLyricsSource = songOverrides?.selectedLyricsSource ?? 'auto'
  const transposeSemitones = songOverrides?.transposeSemitones ?? globalTranspose
  const lyricsOffsetMs = songOverrides?.lyricsOffsetMs ?? 0
  const strumSource = songOverrides?.strumSource ?? globalStrumSource

  // Sync per-song effective values into global store
  const setGlobalTranspose = usePlayerPrefsStore((s) => s.setTransposeSemitones)
  const setGlobalLyricsOffset = usePlayerPrefsStore((s) => s.setLyricsOffsetMs)
  const setGlobalStrumSource = usePlayerPrefsStore((s) => s.setStrumSource)

  // Mirror the current song's effective settings into the shared player store so
  // cross-cutting consumers (transport, chord sheet) read the right values. Writing to a
  // store is a side effect and cannot happen during render, so an effect is required.
  // oxlint-disable-next-line react-doctor/no-derived-state-effect
  useEffect(() => { setGlobalTranspose(transposeSemitones) }, [transposeSemitones, setGlobalTranspose])
  // oxlint-disable-next-line react-doctor/no-derived-state-effect
  useEffect(() => { setGlobalLyricsOffset(lyricsOffsetMs) }, [lyricsOffsetMs, setGlobalLyricsOffset])
  // oxlint-disable-next-line react-doctor/no-derived-state-effect
  useEffect(() => { setGlobalStrumSource(strumSource) }, [strumSource, setGlobalStrumSource])

  const [showTutorial, setShowTutorial] = useState(false)
  const [showDeleteChordsConfirm, setShowDeleteChordsConfirm] = useState(false)
  const isAdmin = useSubscriptionStore((s) => s.status?.is_admin) ?? false
  const { requirePro } = useProAccess()

  const isFavorited = favorites?.some((f) => f.song_id === songId) || false
  const loadingLabel = useRotatingText(
    ['Fetching the music...', 'Getting it...', 'Almost there...'],
    isLoading || !detail,
  )
  const addViewingSong = useJobWatcherStore((s) => s.addViewingSong)
  const removeViewingSong = useJobWatcherStore((s) => s.removeViewingSong)

  const hasStemsProcessed = detail?.stem_types.some(({ name }) => !!detail.stems[name]) ?? false
  const missingSelectedStems = useMemo(
    () => (
      !detail || currentSongId !== songId || isFullSong
        ? []
        : activeStems.filter((stem) => !detail.stems[stem])
    ),
    [detail, currentSongId, songId, isFullSong, activeStems],
  )
  const isWaitingForSelectedStems = missingSelectedStems.length > 0
  const selfHealKey = songId && detail?.needs_self_heal ? songId : null
  const selfHealStartedKeyRef = useRef<string | null>(null)
  const { mutate: startSelfHealing, isError: selfHealingFailed } = useMutation({
    mutationFn: (id: string) => songsApi.selfHeal(id),
    onSuccess: (result, healedSongId) => {
      toast.info(result.message)
      void queryClient.invalidateQueries({ queryKey: queryKeys.songs.detail(healedSongId) })
      if (result.active_job) void queryClient.invalidateQueries({ queryKey: queryKeys.jobs.detail(result.active_job.id) })
    },
    onError: () => {
      toast.error('Could not start self-healing. Reload the song to retry.')
    },
  })
  const selfHealingAttempted = !!selfHealKey && selfHealStartedKeyRef.current === selfHealKey
  const selfHealingStarted = selfHealingAttempted && !selfHealingFailed

  useEffect(() => {
    if (
      !songId
      || !selfHealKey
      || currentSongId !== songId
      || detail?.download_pending
      || detail?.active_job
      || selfHealingAttempted
    ) return
    selfHealStartedKeyRef.current = selfHealKey
    startSelfHealing(songId)
  }, [
    songId,
    selfHealKey,
    currentSongId,
    detail?.download_pending,
    detail?.active_job,
    selfHealingAttempted,
    startSelfHealing,
  ])

  useEffect(() => {
    if (!songId) return
    hasRecordedPlayRef.current = false
    setCurrentSong(songId)

    const prefs = usePlayerPrefsStore.getState()
    const overrides = prefs.songOverrides[songId]

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
  }, [songId, setCurrentSong])

  // A song whose easy shapes need a capo opens in that capo view, once its
  // details arrive — unless the user already picked a view for it.
  const suggestedCapo = detail?.song.id === songId ? detail?.song.easy_capo ?? 0 : null
  const capoDefaultedFor = useRef<string | null>(null)
  useEffect(() => {
    if (!songId || suggestedCapo === null || capoDefaultedFor.current === songId) return
    capoDefaultedFor.current = songId
    if (usePlayerPrefsStore.getState().songOverrides[songId]?.chordDisplayMode !== undefined) return
    if (suggestedCapo > 0) usePlaybackStore.getState().setChordDisplayMode('capo', suggestedCapo)
  }, [songId, suggestedCapo])

  // Abort any in-progress count-in when navigating to a different song so a pending
  // countdown can't start playback on the newly loaded track.
  useEffect(() => {
    cancelCountIn()
  }, [songId, cancelCountIn])

  // Default all available stems to active once stems become processed.
  // Users adjust per-stem volume in the mixer; there's no on/off selection.
  useEffect(() => {
    if (!detail) return
    // Free plan: only the guitar stem is available, so the page plays the full
    // mix and the guitar on its own ("Hear it" / "Learn it") — never a partial band.
    if (detail.stems_locked) {
      const guitarOnly = !isFullSong && activeStems.length === 1 && activeStems[0] === 'guitar'
      if (!isFullSong && !guitarOnly) selectFullSong()
      return
    }
    const availableStems = detail.stem_types.flatMap(({ name }) =>
      detail.stems[name] ? [name] : [],
    )
    if (availableStems.length === 0) {
      if (!isFullSong) selectFullSong()
      return
    }
    const sameSelection =
      !isFullSong
      && activeStems.length === availableStems.length
      && availableStems.every((name) => activeStems.includes(name))
    if (!sameSelection) {
      setActiveStems(availableStems)
    }
  }, [detail, activeStems, isFullSong, setActiveStems, selectFullSong])

  useEffect(() => {
    if (!songId) return
    addViewingSong(songId)
    return () => removeViewingSong(songId)
  }, [songId, addViewingSong, removeViewingSong])

  // Prefetch recommendations when playback first occurs so they appear instantly on pause.
  useEffect(() => {
    if (hasPlaybackOccurred && songId) {
      void queryClient.prefetchQuery({
        queryKey: queryKeys.songs.recommendations(songId),
        queryFn: () => songsApi.recommendations(songId),
        staleTime: 5 * 60 * 1000,
      })
    }
  }, [hasPlaybackOccurred, songId])

  // Load audio when stems or full-song mode changes. Multi-stem playback uses
  // the client-side buffered mixer; single-stem / full-mix use the HTMLAudio path.
  useEffect(() => {
    if (!detail || !songId) return

    if (isFullSong) {
      const url = getAudioUrl(songId, 'full_mix', detail)
      if (url) loadFullSong(url)
      else clear()
      return
    }

    if (activeStems.length === 0) {
      clear()
      return
    }

    const missingSelectedStems = activeStems.filter((stem) => !detail.stems[stem])
    if (missingSelectedStems.length > 0) {
      clear()
      return
    }

    if (activeStems.length === 1) {
      const url = getAudioUrl(songId, activeStems[0], detail)
      if (url) loadFullSong(url)
      else clear()
      return
    }

    const urls = new Map<string, string>()
    for (const stem of activeStems) {
      const url = getMixerUrl(songId, stem, detail)
      if (url) urls.set(stem, url)
    }
    if (urls.size === activeStems.length) {
      const overrides = usePlayerPrefsStore.getState().songOverrides[songId]
      loadStems(urls, overrides?.stemVolumes)
      return
    }
    clear()
  }, [activeStems, clear, detail, isFullSong, loadFullSong, loadStems, songId])

  // If the backend no longer offers a selected stem, remove it from activeStems.
  // Keep the user's selection intact while a processing job is still running so
  // the UI can continue showing "preparing selected stems" instead of bouncing
  // back to the full mix mid-job.
  useEffect(() => {
    if (!detail || isFullSong || detail.active_job) return
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

  // Where the music starts; kept in a ref because the chords are derived further down.
  const musicStartRef = useRef(0)

  const beginPlayback = useCallback(() => {
    setFinishClosed(false)
    // Record the play only when audio actually starts (after any count-in), so a
    // cancelled count-in is not counted as a play.
    if (songId && !hasRecordedPlayRef.current) {
      hasRecordedPlayRef.current = true
      trackCustomEvent('PlaySong', { song_id: songId })
      void songsApi
        .recordPlay(songId)
        .then(() => queryClient.invalidateQueries({ queryKey: queryKeys.favorites.all }))
        .catch(() => {
          hasRecordedPlayRef.current = false
        })
    }
    togglePlay()
  }, [songId, togglePlay])

  const handleTogglePlay = useCallback(() => {
    if (isLoadingStemAudio || isWaitingForSelectedStems) return
    // A second press while counting in starts the song now instead of stacking another count.
    if (isCounting) {
      skipCountIn()
      return
    }
    // Pausing is always immediate — the count-in only precedes starting playback.
    if (isPlaying) {
      togglePlay()
      return
    }
    // Music videos often open with seconds of silence: start where the music does.
    if (usePlaybackStore.getState().currentTime < 0.25 && musicStartRef.current > 0) {
      seek(musicStartRef.current)
    }
    prepareForPlaybackGesture()
    if (countInEnabled) {
      void resumeTickContext()
      // Unlock the element within this gesture so the delayed start is allowed on mobile.
      primeForDelayedStart()
      startCountIn(beginPlayback)
      return
    }
    beginPlayback()
  }, [
    isLoadingStemAudio,
    isWaitingForSelectedStems,
    isCounting,
    skipCountIn,
    isPlaying,
    prepareForPlaybackGesture,
    primeForDelayedStart,
    countInEnabled,
    startCountIn,
    beginPlayback,
    togglePlay,
    seek,
  ])

  const handleSeek = useCallback((time: number) => {
    if (isLoadingStemAudio || isWaitingForSelectedStems) return
    seek(time)
  }, [isLoadingStemAudio, isWaitingForSelectedStems, seek])

  const handleToggleFavorite = () => {
    if (!songId) return
    if (isFavorited) {
      removeFav.mutate(songId)
    } else {
      addFav.mutate(songId)
    }
  }

  // --- Simplified sheet + independent lyrics selection ---
  const sheetVersions = useMemo(
    () => buildSheetVersions(detail?.chord_options ?? []),
    [detail?.chord_options],
  )

  const variantOptions = useMemo(
    () => (detail?.chord_options ?? []).filter((o) => o.is_variant),
    [detail?.chord_options],
  )

  const selectedVersionKey = songOverrides?.selectedVersionKey
  const selectedVersionIndex = useMemo(() => {
    if (selectedVersionKey) {
      const keyedIndex = sheetVersions.findIndex(
        (option, index) => getSheetVersionPreferenceKey(option, index) === selectedVersionKey,
      )
      return keyedIndex === -1 ? 0 : keyedIndex
    }
    return songOverrides?.selectedVersionIndex ?? 0
  }, [sheetVersions, songOverrides?.selectedVersionIndex, selectedVersionKey])

  const activeVersion = sheetVersions[selectedVersionIndex] ?? sheetVersions[0]
  const baseChords = useMemo(() => activeVersion?.chords ?? [], [activeVersion])
  const musicStart = useMemo(() => musicStartTime(baseChords), [baseChords])
  useEffect(() => {
    musicStartRef.current = musicStart
  }, [musicStart])

  // Community/UG sheets only have estimated word timing, so per-word
  // tracking looks broken. Auto-disable tracking when one is active and
  // re-enable it when switching back to a detected/user sheet. Within a
  // single selection the user can still toggle manually.
  const setLyricsMode = usePlayerPrefsStore((s) => s.setLyricsMode)
  const activeSheetSource = activeVersion?.lyrics_source ?? null
  useEffect(() => {
    setLyricsMode(lyricsModeForActiveVersion(activeVersion))
    // Depend on lyrics_source — switching between two non-community sheets
    // shouldn't clobber a manual highlight toggle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSheetSource, setLyricsMode]) // oxlint-disable-line react-doctor/exhaustive-deps

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
    // Beginner mode keeps the pitch but drops slash basses; capo mode keeps both.
    const simplified = chordDisplayMode === 'beginner'
    if (chordDisplayMode === 'beginner') {
      chords = simplifyChords(chords)
    } else if (chordDisplayMode === 'capo' && chordCapoFret > 0) {
      chords = transposeForCapo(chords, chordCapoFret)
    }
    return chords.map((c) => ({
      ...c,
      chord: transposeChordLabel(c.chord, transposeSemitones, { preferSharps: true }),
      // Transpose the slash bass by the same amount so e.g. C/G -> D/A at +2.
      bass:
        simplified || !c.bass
          ? null
          : transposeChordLabel(c.bass, transposeSemitones, { preferSharps: true }),
    }))
  }, [activeChords, transposeSemitones, chordDisplayMode, chordCapoFret])

  const chordNamesForMap = useMemo(() => {
    const source = isEditMode ? editingChords : displayChords
    // Slash-labeled entries (E/B) get their own chord-map card with a
    // bass-note hint, so players can see how to voice what the sheet shows.
    return source.flatMap((c) =>
      c.chord ? [formatChordWithBass(c.chord, c.bass, showBassNotes)] : [],
    )
  }, [isEditMode, editingChords, displayChords, showBassNotes])

  const representativeStrumPattern = useMemo(() => {
    if (!detail) return []
    return getRepresentativeSongStrumPattern(displayChords, detail.strums, {
      rhythm: detail.rhythm,
      maxSymbols: 8,
    })
  }, [detail, displayChords])

  // Only patterns notated in the song's tab are shown; tutorial-site guesses
  // were too often the same generic pattern to be worth playing along to.
  const sectionStrumPatterns = useMemo(
    () => (detail?.tab_rhythm ? getTabStrumPatterns(detail.tab_rhythm, detail.strum_accents) : []),
    [detail],
  )

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

  // --- Player keyboard shortcuts (Space, arrows, L) ---
  useEffect(() => {
    const isBlockedTarget = (target: EventTarget | null): boolean => {
      if (!(target instanceof HTMLElement)) return false
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return true
      // The progress bar handles its own arrow-key seeking while focused —
      // avoid double-seeking when this global handler also fires.
      if (target.getAttribute('role') === 'slider') return true
      return !!target.closest('[role="dialog"]')
    }

    const handler = (e: KeyboardEvent) => {
      if (isBlockedTarget(e.target)) return
      if (e.code === 'Space') {
        e.preventDefault()
        handleTogglePlay()
        return
      }
      if (e.key === 'ArrowLeft') {
        e.preventDefault()
        handleSeek(Math.max(0, usePlaybackStore.getState().currentTime - 5))
        return
      }
      if (e.key === 'ArrowRight') {
        e.preventDefault()
        handleSeek(usePlaybackStore.getState().currentTime + 5)
        return
      }
      if (e.key === 'l' || e.key === 'L') {
        usePlaybackStore.getState().tapLoopMarker(usePlaybackStore.getState().currentTime)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [handleTogglePlay, handleSeek])

  const availableLyricsSources = useMemo(
    () => (detail ? getAvailableLyricsSources(detail, activeVersion) : []),
    [detail, activeVersion],
  )
  const activeLyricsOption = useMemo(
    () =>
      availableLyricsSources.find((option) => option.key === selectedLyricsSource)
      ?? availableLyricsSources[0],
    [availableLyricsSources, selectedLyricsSource],
  )
  const activeLyrics = useMemo(
    () => activeLyricsOption?.segments ?? [],
    [activeLyricsOption],
  )
  const activeLyricsSource = activeLyricsOption?.source ?? null

  // Unsynced community sheets only have estimated word timing, so treating
  // gaps between them as real instrumental sections would be unreliable —
  // keep skip-instrumentals inert there, same signal used for lyricsMode.
  const hasSyncedLyrics = lyricsModeForActiveVersion(activeVersion) === 'highlight'
  const instrumentalGapSegments = useMemo(
    () => (hasSyncedLyrics ? activeLyrics : []),
    [hasSyncedLyrics, activeLyrics],
  )
  // oxlint-disable-next-line react-doctor/no-derived-state-effect
  useEffect(() => {
    setInstrumentalGapSegments(instrumentalGapSegments)
  }, [instrumentalGapSegments, setInstrumentalGapSegments])

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

  const hasVisibleLyrics = activeLyrics.length > 0
  const hasAnyLyrics = availableLyricsSources.some(
    (option) => option.key !== 'off' && option.segments.length > 0,
  )
  const hasTabs = (detail?.tabs?.length ?? 0) > 0 || (detail?.strums?.length ?? 0) > 0 || !!detail?.rhythm
  const hasBars = (detail?.bar_starts?.length ?? 0) > 0

  const handleEnterEditMode = useCallback(() => {
    if (!activeChords.length) return
    if (!requirePro('edit')) return
    enterEditMode(activeChords, activeLyrics)
  }, [activeChords, activeLyrics, enterEditMode, requirePro])

  const handleSetStemVolume = useCallback((stemName: string, volume: number) => {
    if (!songId) return
    setStemVolume(stemName, volume)
    // Read the latest volumes from the store, not the render closure:
    // "Mute all" fires this once per stem in a single tick, and a stale
    // closure would make each call clobber the previous stem's volume.
    const current = usePlayerPrefsStore.getState().songOverrides[songId]?.stemVolumes
    setSongOverride(songId, 'stemVolumes', { ...current, [stemName]: volume })
  }, [songId, setStemVolume, setSongOverride])

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

  // --- Loading / blocking error state ---
  if (isLoading && !detail) {
    return (
      <LoadingSpinner size="lg" label={loadingLabel} className="flex-1 min-h-screen" />
    )
  }

  if (isSongDetailError || !detail) {
    const errorMessage = songDetailError instanceof Error
      ? songDetailError.message
      : 'The song details could not be loaded. Please try again.'

    return (
      <BlockingErrorState
        title="Could not load this song"
        description={errorMessage}
        onRetry={() => void refetchSongDetail()}
        retryTestId="song-detail-retry-button"
      />
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
  const showAudioStatus = isLoadingStemAudio || isWaitingForSelectedStems || (!audioUrl && hasStemsProcessed)
  const audioStatusMessage = isLoadingStemAudio
    ? `Loading selected stems…${stemLoadProgress === null ? '' : ` ${stemLoadProgress}%`}`
    : isWaitingForSelectedStems
      ? detail.active_job
        ? `Preparing ${formatStemList(missingSelectedStems)}… ${detail.active_job.progress}%`
        : selfHealingStarted
          ? `We found an issue with ${formatStemList(missingSelectedStems)}. Self-healing started; this may take longer.`
          : `Selected stems are not ready yet: ${formatStemList(missingSelectedStems)}`
      : undefined

  const headerTitle = displaySongTitle(detail.song)
  const headerArtist = displayArtistName(detail.song)
  const handleSetVersionIndex = (idx: number) => {
    setSongOverride(songId!, 'selectedVersionIndex', idx)
    setSongOverride(songId!, 'selectedVersionKey', getSheetVersionPreferenceKey(sheetVersions[idx], idx))
  }
  const beatBpm = songTempoBpm(detail)

  return (
    <div
      className={cn('relative flex h-full flex-col overflow-hidden bg-stage-950 lg:pb-0', focusMode ? 'pb-0' : 'pb-16')}
      data-testid="song-detail-page"
      data-focus={focusMode}
    >
      <CountInOverlay
        count={countInValue}
        capoFret={chordDisplayMode === 'capo' ? chordCapoFret : 0}
        onSkip={skipCountIn}
        onCancel={cancelCountIn}
      />
      {isPlaying && beatBpm ? <BeatGlow beatTimes={songBeatTimes(detail)} bpm={beatBpm} /> : null}
      {/* The stage: the home page's backstage lights, held still, tinted by the album art */}
      <TourBackdrop active="backstage" scenes={STAGE_SCENES} still />
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div
          className="artwork-backdrop-feather absolute inset-0 scale-125 bg-cover bg-center bg-no-repeat opacity-[0.14] blur-3xl"
          style={{ backgroundImage: `url("${thumbnailSrc}")` }}
        />
      </div>

      {/* Top: the song, its tools and the band on stage */}
      <div className="relative z-30 shrink-0">
        {/* Cap the top area on phones so the chord sheet always keeps the lower part of the screen. */}
        <div className={cn('relative mx-auto flex max-h-[52svh] max-w-7xl flex-col overflow-y-auto overscroll-contain px-3 pb-2.5 pt-3 sm:px-5 sm:pt-4 lg:max-h-none lg:overflow-visible', focusMode ? 'gap-0' : 'gap-2.5')}>
          <SongHeader
            songId={songId!}
            title={headerTitle}
            artist={headerArtist}
            song={detail.song}
            bpm={beatBpm}
            thumbnailSrc={thumbnailSrc}
            isAdmin={isAdmin}
            isFavorited={isFavorited}
            onToggleFavorite={handleToggleFavorite}
            actionsHidden={focusMode}
            isPlaying={isPlaying}
            isPlaybackDisabled={isLoadingStemAudio || isWaitingForSelectedStems}
            onTogglePlay={handleTogglePlay}
            onSeek={handleSeek}
            onThumbnailError={() => songId && markThumbnailFailed(songId)}
            actions={
              <PlayerTools
                detail={detail}
                headerTitle={headerTitle}
                headerArtist={headerArtist}
                hasChords={hasChords}
                isStemSelectionDisabled={isLoadingStemAudio || isWaitingForSelectedStems}
                chordNamesForMap={chordNamesForMap}
                representativeStrumPattern={representativeStrumPattern}
                sectionStrumPatterns={sectionStrumPatterns}
                onEnterEditMode={handleEnterEditMode}
                onOpenTutorial={() => setShowTutorial(true)}
                onSetStemVolume={handleSetStemVolume}
                stemVolumes={songOverrides?.stemVolumes}
                getRecordingTap={getRecordingTap}
                trailing={isEditMode ? undefined : (
                  <SheetPickers
                    hasTabs={hasTabs}
                    hasBars={hasBars}
                    sheetVersions={sheetVersions}
                    activeChords={activeChords}
                    selectedVersionIndex={selectedVersionIndex}
                    availableLyricsSources={availableLyricsSources}
                    selectedLyricsSource={selectedLyricsSource}
                    userEmail={userEmail}
                    chordsUpgrading={chordsUpgrading}
                    onSetVersionIndex={handleSetVersionIndex}
                    onSetLyricsSource={(mode) => setSongOverride(songId!, 'selectedLyricsSource', mode)}
                    onDeleteChords={() => setShowDeleteChordsConfirm(true)}
                  />
                )}
              />
            }
          />

          {showAudioStatus && <AudioStatusBanner message={audioStatusMessage} />}

          <Collapse open={!focusMode}>
            <SongStage
              songId={songId!}
              detail={detail}
              stemVolumes={songOverrides?.stemVolumes}
              isPlaybackDisabled={isLoadingStemAudio || isWaitingForSelectedStems}
              onSetStemVolume={handleSetStemVolume}
            />
          </Collapse>
        </div>
      </div>

      {/* Middle: the chord sheet gets the rest of the screen */}
      <SongContent
        songId={songId!}
        detail={detail}
        headerTitle={headerTitle}
        headerArtist={headerArtist}
        hasStemsProcessed={hasStemsProcessed}
        hasChords={hasChords}
        hasAnyLyrics={hasAnyLyrics}
        hasTabs={hasTabs}
        onTogglePlay={handleTogglePlay}
        displayChords={displayChords}
        activeLyrics={activeLyrics}
        chordNamesForMap={chordNamesForMap}
        representativeStrumPattern={representativeStrumPattern}
        sectionStrumPatterns={sectionStrumPatterns}
        chordsLoading={chordsLoading}
        onSeek={handleSeek}
        onSaveChords={handleSaveChords}
        isSavingChords={saveChordsMutation.isPending}
        onAddChordAtWord={handleAddChordAtWord}
        onOpenTutorial={() => setShowTutorial(true)}
        sheetBar={isEditMode ? undefined : (
          <SheetSourceTabs versions={sheetVersions} selectedIndex={selectedVersionIndex} onSelect={handleSetVersionIndex} />
        )}
        focusMode={focusMode}
      />

      {/* Once the song is over: the next song to play (a pause to practise keeps the sheet) */}
      <SongFinishedDialog
        songId={songId!}
        open={!isPlaying && hasPlaybackOccurred && atSongEnd && !finishClosed}
        onReplay={() => {
          setFinishClosed(true)
          handleSeek(0)
          handleTogglePlay()
        }}
        onClose={() => setFinishClosed(true)}
      />

      {/* Bottom: the player dock */}
      <div className="relative z-30 shrink-0 border-t border-fire-500/15 bg-stage-950/85 shadow-[0_-18px_50px_rgba(0,0,0,0.45)] backdrop-blur-xl">
        <div className="mx-auto max-w-7xl px-3 pb-2.5 pt-2 sm:px-5">
          <PlayerControls
            songId={songId!}
            isPlaybackDisabled={isLoadingStemAudio || isWaitingForSelectedStems}
            hasSyncedLyrics={hasSyncedLyrics}
            focusControls={focusMode ? <FocusToggles /> : undefined}
            onTogglePlay={handleTogglePlay}
            onSeek={handleSeek}
          />
        </div>
      </div>

      {/* Floating YouTube tutorial */}
      {showTutorial && (
        <TutorialOverlay
          tutorialUrl={detail.tutorial_url}
          tutorialLinks={detail.tutorial_links}
          onClose={() => setShowTutorial(false)}
        />
      )}

      <ConfirmDialog
        open={showDeleteChordsConfirm}
        onOpenChange={setShowDeleteChordsConfirm}
        title="Delete your chord version?"
        description="This removes your custom chords for this song. This cannot be undone."
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={() => {
          if (songId) deleteChordsMutation.mutate({ songId })
        }}
      />

      {showLyricsDebug && hasVisibleLyrics && (
        <LyricsDebugOverlay lyrics={activeLyrics} lyricsSource={activeLyricsSource} />
      )}
    </div>
  )
}

import { useParams } from 'react-router-dom'
import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { ChevronLeft, ChevronRight, Heart, Pause, Play, Shield, SkipBack, SkipForward, X } from 'lucide-react'
import { toast } from 'sonner'
import { useSongDetail } from '../hooks/use-song-detail'
import { useAudioPlayer } from '../hooks/use-audio-player'
import { useWakeLock } from '../hooks/use-wake-lock'
import { useLyricsSync } from '../hooks/use-lyrics-sync'
import { normalizeWords } from '../lib/normalize-words'
import { getRepresentativeSongStrumPattern, getSectionStrumPatterns } from '../lib/strum-pattern'
import { TransportControls } from '../components/TransportControls'
import { TrackSelector } from '../components/TrackSelector'
import { ChordSheet } from '../components/ChordSheet'
import { ChordOptionSelector } from '../components/ChordOptionSelector'
import { TabsSheet } from '../components/TabsSheet'
import { ProcessButton } from '../components/ProcessButton'
import { BackgroundProcessingCard } from '../components/BackgroundProcessingCard'
import { ChordMap, ChordDiagram } from '../components/ChordMap'
import { ChordMapDialog } from '../components/ChordMapDialog'
import { PlaybackSpeedSelector } from '../components/PlaybackSpeedSelector'
import { ChordDisplayControls } from '../components/ChordDisplayControls'

import { LyricsSyncControl } from '../components/LyricsSyncControl'
import { LyricsVersionToggle } from '../components/LyricsVersionToggle'
import { ChordVersionToggle } from '../components/ChordVersionToggle'
import { ScrollModeControl } from '../components/ScrollModeControl'
import { OnboardingTour } from '../components/OnboardingTour'
import { LyricsSyncDebug } from '../components/LyricsSyncDebug'
import { SongFeedback } from '../components/SongFeedback'
import { RecordButton } from '../components/RecordButton'
import { useRotatingText } from '@/features/search/hooks/use-rotating-text'
import { LoadingSpinner } from '@/components/shared/LoadingSpinner'
import { usePlaybackStore, type StemName } from '@/stores/playback.store'
import { usePlayerPrefsStore } from '@/stores/player-prefs.store'
import { useSubscriptionStore } from '@/stores/subscription.store'
import { useSongMediaCacheStore } from '@/stores/song-media-cache.store'
import { useToggleFavorite } from '@/features/library/hooks/use-toggle-favorite'
import { useFavorites } from '@/features/library/hooks/use-favorites'
import { useJobWatcherStore } from '@/stores/job-watcher.store'
import { env } from '@/config/env'
import { songsApi } from '@/api/songs.api'
import { cn } from '@/lib/cn'
import { trackCustomEvent } from '@/lib/meta-pixel'
import { displayArtistName, displaySongTitle, getThumbnailUrl } from '@/lib/format-song'
import { transposeChordLabel } from '@/lib/chord-utils'
import type { LyricsSegment } from '@/types/song'

function pickLyricsVersion(
  preferred: LyricsSegment[] | undefined,
  legacy: LyricsSegment[] | undefined,
): LyricsSegment[] {
  return preferred ?? legacy ?? []
}

function pickLyricsSource(preferred?: string | null, legacy?: string | null): string | null {
  return preferred ?? legacy ?? null
}

function CurrentChordPanel({ chords }: { chords: { chord: string; start_time: number; end_time: number }[] }) {
  const currentTime = usePlaybackStore((s) => s.currentTime)
  const displayChord = useMemo(() => {
    // Prefer the chord that currently spans currentTime.
    const active = chords.find(
      (c) => currentTime >= c.start_time && currentTime < c.end_time && c.chord !== 'N'
    )
    if (active?.chord) return active.chord

    // Otherwise, keep showing the most recent non-'N' chord.
    for (let i = chords.length - 1; i >= 0; i--) {
      const c = chords[i]
      if (c.chord !== 'N' && currentTime >= c.start_time) return c.chord
    }

    return null
  }, [chords, currentTime])
  if (!displayChord) return null
  return (
    <div className="hidden lg:block w-48 shrink-0">
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-smoke-200">Current Chord</h3>
        </div>
        <ChordDiagram chord={displayChord} />
      </div>
    </div>
  )
}

function AdminMenu({ songId }: { songId: string }) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState<string | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const handleRegenerate = async (targets: string[], label: string) => {
    setLoading(label)
    setOpen(false)
    try {
      const result = await songsApi.regenerate(songId, targets)
      if (result.enqueued.length > 0) {
        toast.success(`Regenerating: ${result.enqueued.join(', ')}`)
      } else if (result.errors.length > 0) {
        toast.error(`Failed: ${result.errors.join(', ')}`)
      } else {
        toast.info(`Skipped (already up to date): ${result.skipped.join(', ')}`)
      }
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      toast.error(detail ?? 'Regeneration failed')
    } finally {
      setLoading(null)
    }
  }

  const items = [
    { label: 'Regenerate Lyrics', targets: ['lyrics'] },
    { label: 'Regenerate Stems & Chords', targets: ['stems'] },
    { label: 'Regenerate Tabs', targets: ['tabs'] },
    { label: 'Regenerate Strum Patterns', targets: ['strums'] },
    { label: 'Regenerate All', targets: ['lyrics', 'stems', 'tabs', 'strums'] },
    { label: 'Full Reprocess', targets: ['full'] },
  ]

  return (
    <div ref={menuRef} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'p-2 rounded-lg text-smoke-400 hover:text-flame-400 hover:bg-charcoal-700/50 transition-colors',
          open && 'text-flame-400 bg-charcoal-700/50',
        )}
        aria-label="Admin actions"
        title="Admin actions"
      >
        {loading ? (
          <LoadingSpinner size="xs" inline className="h-5 w-5" />
        ) : (
          <Shield size={20} />
        )}
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 w-56 rounded-lg bg-charcoal-800 border border-charcoal-600 shadow-xl z-50 py-1">
          {items.map((item) => (
            <button
              key={item.label}
              onClick={() => handleRegenerate(item.targets, item.label)}
              disabled={!!loading}
              className="w-full text-left px-3 py-2 text-sm text-smoke-200 hover:bg-charcoal-700 hover:text-flame-400 transition-colors disabled:opacity-50"
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function getAudioUrl(songId: string, stem: StemName, detail: { audio_url: string | null; stems: { [key: string]: string | null } }) {
  if (env.isLocal) {
    const stemName = stem === 'full_mix' ? 'audio' : stem
    return `${env.apiBaseUrl}/api/v1/songs/${songId}/stream?stem=${stemName}`
  }
  if (stem === 'full_mix') return detail.audio_url
  return detail.stems[stem] || null
}

export function SongDetailPage() {
  const { songId } = useParams<{ songId: string }>()
  const { loadStems, loadFullSong, togglePlay, seek } = useAudioPlayer()
  const hasRecordedPlayRef = useRef(false)
  const activeStems = usePlaybackStore((s) => s.activeStems)
  const isFullSong = usePlaybackStore((s) => s.isFullSong)
  const toggleStem = usePlaybackStore((s) => s.toggleStem)
  const setActiveStems = usePlaybackStore((s) => s.setActiveStems)
  const selectFullSong = usePlaybackStore((s) => s.selectFullSong)
  const setCurrentSong = usePlaybackStore((s) => s.setCurrentSong)
  const selectedChordOptionIndex = usePlaybackStore((s) => s.selectedChordOptionIndex)
  const sheetMode = usePlaybackStore((s) => s.sheetMode)
  const isPlaying = usePlaybackStore((s) => s.isPlaying)
  useWakeLock(isPlaying)
  const { data: detail, isLoading } = useSongDetail(songId!, { pollForTabs: true })
  const { data: favorites } = useFavorites()
  const { add: addFav, remove: removeFav } = useToggleFavorite()
  const globalTranspose = usePlayerPrefsStore((s) => s.transposeSemitones)
  const globalLyricsMode = usePlayerPrefsStore((s) => s.lyricsMode)
  const globalLyricsOffset = usePlayerPrefsStore((s) => s.lyricsOffsetMs)
  const globalStrumSource = usePlayerPrefsStore((s) => s.strumSource)
  const songOverrides = usePlayerPrefsStore((s) => s.songOverrides[songId!])
  const setSongOverride = usePlayerPrefsStore((s) => s.setSongOverride)

  // Per-song values with global fallback
  const chordVersion = songOverrides?.chordVersion ?? 'v2'
  const lyricsMode = songOverrides?.lyricsMode ?? globalLyricsMode
  const transposeSemitones = songOverrides?.transposeSemitones ?? globalTranspose
  const lyricsOffsetMs = songOverrides?.lyricsOffsetMs ?? globalLyricsOffset
  const strumSource = songOverrides?.strumSource ?? globalStrumSource

  // Sync per-song effective values into global store so child components
  // that read from the global store (ChordDisplayControls, LyricsSyncControl, etc.) work.
  const setGlobalTranspose = usePlayerPrefsStore((s) => s.setTransposeSemitones)
  const setGlobalLyricsOffset = usePlayerPrefsStore((s) => s.setLyricsOffsetMs)
  const setGlobalLyricsMode = usePlayerPrefsStore((s) => s.setLyricsMode)
  const setGlobalStrumSource = usePlayerPrefsStore((s) => s.setStrumSource)

  useEffect(() => {
    setGlobalTranspose(transposeSemitones)
  }, [transposeSemitones, setGlobalTranspose])

  useEffect(() => {
    setGlobalLyricsOffset(lyricsOffsetMs)
  }, [lyricsOffsetMs, setGlobalLyricsOffset])

  useEffect(() => {
    setGlobalLyricsMode(lyricsMode)
  }, [lyricsMode, setGlobalLyricsMode])

  useEffect(() => {
    setGlobalStrumSource(strumSource)
  }, [strumSource, setGlobalStrumSource])

  // Track whether we've auto-detected lyrics for this song load
  const didAutoDetectLyrics = useRef(false)

  const [showTutorial, setShowTutorial] = useState(false)
  const [tutorialIndex, setTutorialIndex] = useState(0)
  const isAdmin = useSubscriptionStore((s) => s.status?.is_admin) ?? false

  const isFavorited = favorites?.some((f) => f.song_id === songId) || false
  const loadingLabel = useRotatingText(
    ['Fetching the music…', 'Getting it…', 'Almost there…'],
    isLoading || !detail,
  )
  const addViewingSong = useJobWatcherStore((s) => s.addViewingSong)
  const removeViewingSong = useJobWatcherStore((s) => s.removeViewingSong)

  const hasStemsProcessed = detail?.stem_types.some(({ name }) => !!detail.stems[name]) ?? false

  useEffect(() => {
    if (!songId) return
    hasRecordedPlayRef.current = false
    didAutoDetectLyrics.current = false
    setCurrentSong(songId)
    // Initialize stems from user's default preferences.
    const defaults = usePlayerPrefsStore.getState().defaultStems
    if (defaults.length > 0) {
      setActiveStems(defaults)
    }
  }, [songId, setCurrentSong, setActiveStems])

  // Track which song the user is currently viewing so the global JobWatcher
  // can suppress in-app toasts when the user is already on the song page.
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

  // Resolve base chords based on chord version (V1=autochord, V2=gemini)
  const hasV1Chords = detail?.chord_options?.some((o) => o.name === 'Detected (V1)') ?? false
  const hasV2Chords = detail?.chord_source === 'gemini'

  const baseChords = useMemo(() => {
    if (!detail) return []
    if (chordVersion === 'v1' && hasV1Chords) {
      const v1Option = detail.chord_options?.find((o) => o.name === 'Detected (V1)')
      if (v1Option) return v1Option.chords
    }
    return detail.chords
  }, [detail, chordVersion, hasV1Chords])

  // Chord options excluding the V1 source option (that's handled by the version toggle)
  const filteredChordOptions = useMemo(
    () => (detail?.chord_options ?? []).filter((o) => o.name !== 'Detected (V1)'),
    [detail?.chord_options],
  )

  // Resolve active chords based on selected chord option (beginner, capo, etc.)
  const activeChords = useMemo(() => {
    if (!detail) return []
    if (selectedChordOptionIndex !== null && filteredChordOptions[selectedChordOptionIndex]) {
      return filteredChordOptions[selectedChordOptionIndex].chords
    }
    return baseChords
  }, [detail, selectedChordOptionIndex, filteredChordOptions, baseChords])

  const displayChords = useMemo(() => {
    if (activeChords.length === 0) return activeChords
    return activeChords.map((c) => ({
      ...c,
      chord: transposeChordLabel(c.chord, transposeSemitones, { preferSharps: true }),
    }))
  }, [activeChords, transposeSemitones])

  const chordNamesForMap = useMemo(() => displayChords.map((c) => c.chord).filter(Boolean), [displayChords])
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

  // Resolve which lyrics version to display (hook must be before early return)
  const ver1Lyrics = useMemo(
    () => (detail ? pickLyricsVersion(detail.ver1_lyrics, detail.quick_lyrics) : []),
    [detail],
  )
  const ver2Lyrics = useMemo(
    () => (detail ? pickLyricsVersion(detail.ver2_lyrics, detail.lyrics) : []),
    [detail],
  )
  const ver3Lyrics = useMemo(
    () => (detail ? pickLyricsVersion(detail.ver3_lyrics, detail.corrected_lyrics) : []),
    [detail],
  )
  const ver1LyricsSource = detail
    ? pickLyricsSource(detail.ver1_lyrics_source, detail.quick_lyrics_source)
    : null
  const ver2LyricsSource = detail
    ? pickLyricsSource(detail.ver2_lyrics_source, detail.lyrics_source)
    : null
  const ver3LyricsSource = detail
    ? pickLyricsSource(detail.ver3_lyrics_source, detail.corrected_lyrics_source)
    : null
  const ver4Lyrics = useMemo(
    () => (detail?.ver4_lyrics?.length ? detail.ver4_lyrics : []),
    [detail],
  )
  const ver4LyricsSource = detail?.ver4_lyrics_source ?? null

  // Auto-switch to ver3 once when corrected lyrics become available,
  // but only if the user hasn't explicitly set a per-song override.
  useEffect(() => {
    if (didAutoDetectLyrics.current) return
    if (songOverrides?.lyricsMode !== undefined) return
    if (ver3Lyrics.length > 0 && lyricsMode !== 'ver3' && lyricsMode !== 'ver4' && lyricsMode !== 'none') {
      setGlobalLyricsMode('ver3')
      didAutoDetectLyrics.current = true
    }
  }, [ver3Lyrics.length, lyricsMode, songOverrides?.lyricsMode, setGlobalLyricsMode])

  const activeLyrics = useMemo(() => {
    if (!detail) return []
    const hasVer1 = ver1Lyrics.length > 0
    const hasVer2 = ver2Lyrics.length > 0
    const hasVer3 = ver3Lyrics.length > 0
    const hasVer4 = ver4Lyrics.length > 0
    if (lyricsMode === 'ver4' && hasVer4) return ver4Lyrics
    if (lyricsMode === 'ver3' && hasVer3) return ver3Lyrics
    if (lyricsMode === 'ver2' && hasVer2) return ver2Lyrics
    if (lyricsMode === 'ver1' && hasVer1) return ver1Lyrics
    // For 'none' or when preferred version isn't available, fall back
    if (hasVer3) return ver3Lyrics
    if (hasVer2) return ver2Lyrics
    return ver1Lyrics
  }, [detail, lyricsMode, ver1Lyrics, ver2Lyrics, ver3Lyrics, ver4Lyrics])

  const activeLyricsSource = useMemo(() => {
    if (!detail) return null
    const hasVer1 = ver1Lyrics.length > 0
    const hasVer2 = ver2Lyrics.length > 0
    const hasVer3 = ver3Lyrics.length > 0
    const hasVer4 = ver4Lyrics.length > 0
    if (lyricsMode === 'ver4' && hasVer4) return ver4LyricsSource
    if (lyricsMode === 'ver3' && hasVer3) return ver3LyricsSource
    if (lyricsMode === 'ver2' && hasVer2) return ver2LyricsSource
    if (lyricsMode === 'ver1' && hasVer1) return ver1LyricsSource
    if (hasVer3) return ver3LyricsSource
    if (hasVer2) return ver2LyricsSource
    return ver1LyricsSource
  }, [
    detail,
    lyricsMode,
    ver1Lyrics.length,
    ver1LyricsSource,
    ver2Lyrics.length,
    ver2LyricsSource,
    ver3Lyrics.length,
    ver3LyricsSource,
    ver4Lyrics.length,
    ver4LyricsSource,
  ])

  // Normalize lyrics for the debug overlay (same transform the display components use)
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

  const hasVer1Lyrics = ver1Lyrics.length > 0
  const hasVer2Lyrics = ver2Lyrics.length > 0
  const hasVer3Lyrics = ver3Lyrics.length > 0
  const hasVer4Lyrics = ver4Lyrics.length > 0
  const hasAnyLyrics = hasVer1Lyrics || hasVer2Lyrics || hasVer3Lyrics || hasVer4Lyrics
  const hasTabs = (detail?.tabs?.length ?? 0) > 0 || (detail?.strums?.length ?? 0) > 0 || !!detail?.rhythm

  const isJobProcessing =
    detail?.active_job?.status === 'PENDING' || detail?.active_job?.status === 'PROCESSING'

  // Ver 3 is generated from ver1 + ver2. While it's being created,
  // keep the toggle visible and show a spinner on the Ver 3 option.
  const isVer3LyricsGenerating =
    !!detail && !hasVer3Lyrics && hasVer1Lyrics && hasVer2Lyrics && (isJobProcessing || !detail.active_job)

  // When a song loads, pick the best available lyrics mode — but only if
  // the user hasn't explicitly set a per-song override for this song.
  // Default: v3 > (non-English: v1 > v2) / (English: v2 > v1) > none
  useEffect(() => {
    if (!detail) return
    if (songOverrides?.lyricsMode !== undefined) return
    if (didAutoDetectLyrics.current) return
    didAutoDetectLyrics.current = true

    const sampleText = (ver1Lyrics[0]?.text ?? ver2Lyrics[0]?.text ?? '').slice(0, 200)
    const nonAsciiRatio = sampleText.length > 0
      ? [...sampleText].filter((c) => c.charCodeAt(0) > 127).length / sampleText.length
      : 0
    const isNonEnglish = nonAsciiRatio > 0.3

    if (hasVer3Lyrics) {
      setGlobalLyricsMode('ver3')
    } else if (isNonEnglish) {
      if (hasVer1Lyrics) setGlobalLyricsMode('ver1')
      else if (hasVer2Lyrics) setGlobalLyricsMode('ver2')
      else setGlobalLyricsMode('none')
    } else {
      if (hasVer2Lyrics) setGlobalLyricsMode('ver2')
      else if (hasVer1Lyrics) setGlobalLyricsMode('ver1')
      else setGlobalLyricsMode('none')
    }
  }, [detail, songOverrides?.lyricsMode, hasVer1Lyrics, hasVer2Lyrics, hasVer3Lyrics, ver1Lyrics, ver2Lyrics, setGlobalLyricsMode])

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
  const hasChordSheet = hasChords || hasAnyLyrics || chordsLoading

  const showBackgroundProcessing = hasStemsProcessed && hasChords && (!hasAnyLyrics || (sheetMode === 'tabs' && !hasTabs))
  // Only show audio status when stems are processed but the selected stem URL
  // is still loading. Hide it during processing (the checklist covers that).
  const showAudioStatus = !audioUrl && hasStemsProcessed

  const headerTitle = displaySongTitle(detail.song)
  const headerArtist = displayArtistName(detail.song)

  return (
    <div className="relative h-full flex flex-col overflow-hidden" data-testid="song-detail-page">
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
          {/* Song header */}
          <div className="relative flex items-center gap-3 sm:gap-4">
            <div className="relative size-12 sm:size-16 lg:size-20 shrink-0 rounded-xl overflow-hidden bg-charcoal-800 ring-1 ring-white/8 shadow-[0_10px_30px_rgba(0,0,0,0.35)]">
              <img
                src={thumbnailSrc}
                alt=""
                className="w-full h-full object-cover"
                onError={() => songId && markThumbnailFailed(songId)}
              />
            </div>

            <div className="min-w-0 flex-1">
              <h1 className="text-xl sm:text-2xl font-bold leading-tight truncate">{headerTitle}</h1>
              <div className="flex items-center gap-2">
                <p className="text-smoke-400 text-sm sm:text-base truncate">{headerArtist}</p>
                <SongFeedback songId={songId!} />
                {isAdmin && <AdminMenu songId={songId!} />}
              </div>
            </div>

            {/* Mobile-only: transport buttons live in the header row to save vertical space */}
            <div className="sm:hidden shrink-0 flex items-center gap-2">
              <button
                onClick={() => seek(Math.max(0, usePlaybackStore.getState().currentTime - 10))}
                className="text-smoke-400 hover:text-smoke-100 transition-colors"
                aria-label="Back 10 seconds"
              >
                <SkipBack size={22} />
              </button>
              <button
                onClick={handleTogglePlay}
                className={cn(
                  'w-12 h-12 rounded-full bg-flame-400 flex items-center justify-center text-charcoal-950 hover:bg-flame-500 transition-all',
                  isPlaying ? 'animate-flame-pulse' : '',
                )}
                aria-label={isPlaying ? 'Pause' : 'Play'}
              >
                {isPlaying ? <Pause size={20} /> : <Play size={20} className="ml-0.5" />}
              </button>
              <button
                onClick={() => { const s = usePlaybackStore.getState(); seek(Math.min(s.duration, s.currentTime + 10)) }}
                className="text-smoke-400 hover:text-smoke-100 transition-colors"
                aria-label="Forward 10 seconds"
              >
                <SkipForward size={22} />
              </button>
            </div>
          </div>

          {/* Player controls */}
          <div className="flex flex-col gap-4">
            {showAudioStatus && (
              <div
                className="flex items-center justify-center gap-2 rounded-lg border border-charcoal-700 bg-charcoal-900/40 px-3 py-2 text-sm text-smoke-300"
                aria-live="polite"
              >
                <LoadingSpinner size="xs" inline />
                <span>
                  {isFullSong
                    ? 'Downloading audio…'
                    : `Preparing ${activeStems.map((s) => s.replaceAll('_', ' ')).join(', ')}…`}
                </span>
              </div>
            )}
            <TransportControls
              onTogglePlay={handleTogglePlay}
              onSeek={seek}
              primaryControls={
                <>
                  <button
                    onClick={handleToggleFavorite}
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
                  <div className="contents" data-tour="stem-selector">
                    <TrackSelector
                      activeStems={activeStems}
                      isFullSong={isFullSong}
                      onToggleStem={toggleStem}
                      onSelectFullSong={selectFullSong}
                      availableStems={detail.stems}
                      stemTypes={detail.stem_types}
                    />
                  </div>
                  <ChordVersionToggle
                    hasV1={hasV1Chords}
                    hasV2={hasV2Chords}
                    selected={chordVersion}
                    onSelect={(v) => setSongOverride(songId!, 'chordVersion', v)}
                  />
                  <div className="contents" data-tour="lyrics-toggle">
                    <LyricsVersionToggle
                      hasVer1Lyrics={hasVer1Lyrics}
                      hasVer2Lyrics={hasVer2Lyrics}
                      hasVer3Lyrics={hasVer3Lyrics}
                      hasVer4Lyrics={hasVer4Lyrics}
                      isVer3Generating={isVer3LyricsGenerating}
                      selected={lyricsMode}
                      onSelect={(mode) => setSongOverride(songId!, 'lyricsMode', mode)}
                    />
                  </div>
                  <div className="contents" data-tour="chord-map">
                    <ChordMapDialog chords={chordNamesForMap} representativePattern={representativeStrumPattern} sectionPatterns={sectionStrumPatterns} bpm={detail.source_bpm ?? detail.rhythm?.bpm} strumNotes={detail.strum_notes} tutorialUrl={detail.tutorial_url} tutorialLinks={detail.tutorial_links} strumLoading={!detail.songsterr_status} iconOnly onOpenTutorial={() => setShowTutorial(true)} />
                  </div>
                </>
              }
              secondaryControls={
                <>
                  <ChordOptionSelector
                    chordOptions={filteredChordOptions}
                    hasTabs={hasTabs}
                    recommendedCapo={detail.recommended_capo}
                    songKey={detail.song_key}
                    chordSource={chordVersion === 'v1' ? 'autochord' : detail.chord_source}
                  />
                  <ChordDisplayControls />

                  <PlaybackSpeedSelector />
                  <LyricsSyncControl />
                  <ScrollModeControl />
                </>
              }
            />
          </div>
        </div>
      </div>

      {/* Ver 3 lyrics generating banner */}
      {isVer3LyricsGenerating && (
        <div className="relative z-20 bg-flame-400/10 border-b border-flame-400/20 px-4 py-2 flex items-center justify-center gap-2 text-sm text-flame-300">
          <LoadingSpinner size="xs" inline className="h-3 w-3" />
          <span>Generating Ver 3 lyrics — using Ver 2 in the meantime</span>
        </div>
      )}

      {/* Content — fills remaining space */}
      <div className="relative z-10 flex-1 min-h-0 flex flex-col">
        <div className="max-w-7xl mx-auto p-4 w-full flex-1 min-h-0 flex flex-col">
          {/* ProcessButton handles its own visibility (returns null when fully done) */}
          <ProcessButton
            songId={songId!}
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

          {/* Show chords/tabs once stems and chords are available.
              Tabs/lyrics continue generating in background with a banner. */}
          {hasStemsProcessed && hasChords && (
            <>
              {/* Background generation — keep the same checklist UX as the main pipeline, but non-blocking */}
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
                    {chordsUpgrading && (
                      <div
                        className="flex items-center gap-2 px-3 py-1.5 mb-2 rounded-lg bg-flame-400/10 border border-flame-400/20 text-smoke-300 text-xs"
                        data-testid="chords-upgrading-banner"
                      >
                        <div className="h-3 w-3 animate-spin rounded-full border-[1.5px] border-smoke-600 border-t-flame-400 shrink-0" />
                        <span>Improving chords — a more accurate version should be available in 1-2 minutes</span>
                      </div>
                    )}
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
                        onSeek={seek}
                      />
                    ) : (
                      <ChordSheet
                        chords={displayChords}
                        lyrics={activeLyrics}
                        onSeek={seek}
                      />
                    )}
                  </div>
                  <div className="hidden lg:flex w-full lg:w-80 lg:shrink-0 min-h-0 flex-col">
                    <ChordMap chords={chordNamesForMap} representativePattern={representativeStrumPattern} sectionPatterns={sectionStrumPatterns} bpm={detail.source_bpm ?? detail.rhythm?.bpm} strumNotes={detail.strum_notes} tutorialUrl={detail.tutorial_url} tutorialLinks={detail.tutorial_links} strumLoading={!detail.songsterr_status} onOpenTutorial={() => setShowTutorial(true)} />
                  </div>
                </div>
              ) : null}
            </>
          )}
        </div>
      </div>

      {/* Floating YouTube tutorial window */}
      {showTutorial && detail && (() => {
        // Build list of embeddable tutorials
        const allLinks = detail.tutorial_links?.length
          ? detail.tutorial_links
          : detail.tutorial_url
            ? [{ url: detail.tutorial_url, title: '' }]
            : []
        const embedItems = allLinks
          .map((link) => {
            const match = link.url.match(/(?:youtube\.com\/.*[?&]v=|youtu\.be\/)([\w-]+)/)
            return match ? { embedUrl: `https://www.youtube.com/embed/${match[1]}`, title: link.title } : null
          })
          .filter((x): x is { embedUrl: string; title: string } => x !== null)

        if (embedItems.length === 0) return null
        const safeIndex = Math.min(tutorialIndex, embedItems.length - 1)
        const current = embedItems[safeIndex]

        return (
          <div className="fixed bottom-4 left-4 right-4 z-60 max-w-100 ml-auto rounded-lg overflow-hidden shadow-2xl border border-charcoal-600 bg-charcoal-900">
            <div className="flex items-center justify-between px-3 py-2 bg-charcoal-800">
              <span className="text-xs text-smoke-300 font-medium truncate flex-1 mr-2">
                {current.title || 'Tutorial'}
              </span>
              <div className="flex items-center gap-0.5 sm:gap-1">
                {embedItems.length > 1 && (
                  <>
                    <button
                      type="button"
                      onClick={() => setTutorialIndex((i) => Math.max(0, i - 1))}
                      disabled={safeIndex === 0}
                      className="text-smoke-500 hover:text-smoke-200 disabled:opacity-30 transition-colors p-2 sm:p-0.5"
                      aria-label="Previous tutorial"
                      data-testid="tutorial-prev-button"
                    >
                      <ChevronLeft size={18} className="sm:size-3.5" />
                    </button>
                    <span className="text-xs sm:text-[10px] text-smoke-500 tabular-nums">
                      {safeIndex + 1}/{embedItems.length}
                    </span>
                    <button
                      type="button"
                      onClick={() => setTutorialIndex((i) => Math.min(embedItems.length - 1, i + 1))}
                      disabled={safeIndex === embedItems.length - 1}
                      className="text-smoke-500 hover:text-smoke-200 disabled:opacity-30 transition-colors p-2 sm:p-0.5"
                      aria-label="Next tutorial"
                      data-testid="tutorial-next-button"
                    >
                      <ChevronRight size={18} className="sm:size-3.5" />
                    </button>
                  </>
                )}
                <button
                  type="button"
                  onClick={() => { setShowTutorial(false); setTutorialIndex(0) }}
                  className="text-smoke-500 hover:text-smoke-200 transition-colors ml-1 p-2 sm:p-0"
                  aria-label="Close tutorial"
                  data-testid="tutorial-close-button"
                >
                  <X size={18} className="sm:size-3.5" />
                </button>
              </div>
            </div>
            <iframe
              src={current.embedUrl}
              className="w-full aspect-video"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
              title={current.title || 'Guitar tutorial'}
            />
          </div>
        )
      })()}

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

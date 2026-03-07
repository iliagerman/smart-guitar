import { useParams } from 'react-router-dom'
import { useState, useEffect, useCallback, useMemo } from 'react'
import { Heart, Pause, Play, SkipBack, SkipForward } from 'lucide-react'
import { useSongDetail } from '../hooks/use-song-detail'
import { useAudioPlayer } from '../hooks/use-audio-player'
import { useLyricsSync } from '../hooks/use-lyrics-sync'
import { normalizeWords } from '../lib/normalize-words'
import { TransportControls } from '../components/TransportControls'
import { TrackSelector } from '../components/TrackSelector'
import { ChordSheet } from '../components/ChordSheet'
import { ChordOptionSelector } from '../components/ChordOptionSelector'
// Tabs disabled.
// import { TabsSheet } from '../components/TabsSheet'
import { ProcessButton } from '../components/ProcessButton'
import { BackgroundProcessingCard } from '../components/BackgroundProcessingCard'
import { ChordMap, ChordDiagram } from '../components/ChordMap'
import { ChordMapDialog } from '../components/ChordMapDialog'
import { PlaybackSpeedSelector } from '../components/PlaybackSpeedSelector'
import { ChordDisplayControls } from '../components/ChordDisplayControls'
import { LyricsSyncControl } from '../components/LyricsSyncControl'
import { LyricsVersionToggle } from '../components/LyricsVersionToggle'
import { ScrollModeControl } from '../components/ScrollModeControl'
import { LyricsSyncDebug } from '../components/LyricsSyncDebug'
import { SongFeedback } from '../components/SongFeedback'
import { useRotatingText } from '@/features/search/hooks/use-rotating-text'
import { usePlaybackStore, type StemName } from '@/stores/playback.store'
import { usePlayerPrefsStore } from '@/stores/player-prefs.store'
import { useSongMediaCacheStore } from '@/stores/song-media-cache.store'
import { useToggleFavorite } from '@/features/library/hooks/use-toggle-favorite'
import { useFavorites } from '@/features/library/hooks/use-favorites'
import { useJobWatcherStore } from '@/stores/job-watcher.store'
import { env } from '@/config/env'
import { cn } from '@/lib/cn'
import { displayArtistName, displaySongTitle, getThumbnailUrl } from '@/lib/format-song'
import { transposeChordLabel } from '@/lib/chord-utils'

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
  const { loadTrack, togglePlay, seek } = useAudioPlayer()
  const currentStem = usePlaybackStore((s) => s.currentStem)
  const setStem = usePlaybackStore((s) => s.setStem)
  const setCurrentSong = usePlaybackStore((s) => s.setCurrentSong)
  const selectedChordOptionIndex = usePlaybackStore((s) => s.selectedChordOptionIndex)
  const sheetMode = usePlaybackStore((s) => s.sheetMode)
  const isPlaying = usePlaybackStore((s) => s.isPlaying)
  const { data: detail, isLoading } = useSongDetail(songId!, { pollForTabs: false })
  const { data: favorites } = useFavorites()
  const { add: addFav, remove: removeFav } = useToggleFavorite()
  const transposeSemitones = usePlayerPrefsStore((s) => s.transposeSemitones)
  // Tabs/strums disabled.
  // const showStrums = usePlayerPrefsStore((s) => s.showStrums)
  // const toggleShowStrums = usePlayerPrefsStore((s) => s.toggleShowStrums)
  const lyricsMode = usePlayerPrefsStore((s) => s.lyricsMode)
  const setLyricsMode = usePlayerPrefsStore((s) => s.setLyricsMode)

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
    setCurrentSong(songId)
    // Default the track selector to vocals when entering a song detail page.
    // This runs on song changes only and won't interfere with subsequent user selections.
    setStem('vocals')
  }, [songId, setCurrentSong, setStem])

  // Track which song the user is currently viewing so the global JobWatcher
  // can suppress in-app toasts when the user is already on the song page.
  useEffect(() => {
    if (!songId) return
    addViewingSong(songId)
    return () => removeViewingSong(songId)
  }, [songId, addViewingSong, removeViewingSong])

  useEffect(() => {
    if (!detail || !songId) return
    const url = getAudioUrl(songId, currentStem, detail)
    if (url) loadTrack(url)
  }, [detail, songId, currentStem, loadTrack])

  // If the backend no longer offers the currently selected stem (e.g. legacy
  // localStorage value like 'drums'), fall back to a valid option.
  useEffect(() => {
    if (!detail) return

    const offered = new Set(detail.stem_types.map((s) => s.name))
    const isValid = currentStem === 'full_mix' || offered.has(currentStem)
    if (isValid) return

    // Prefer vocals if it's offered; otherwise default to full mix.
    setStem(offered.has('vocals') ? 'vocals' : 'full_mix')
  }, [detail, currentStem, setStem])

  const handleStemChange = useCallback(
    (stem: StemName) => {
      setStem(stem)
    },
    [setStem]
  )

  const handleToggleFavorite = () => {
    if (!songId) return
    if (isFavorited) {
      removeFav.mutate(songId)
    } else {
      addFav.mutate(songId)
    }
  }

  // Resolve active chords based on selected chord option
  const activeChords = useMemo(() => {
    if (!detail) return []
    if (selectedChordOptionIndex !== null && detail.chord_options?.[selectedChordOptionIndex]) {
      return detail.chord_options[selectedChordOptionIndex].chords
    }
    return detail.chords
  }, [detail, selectedChordOptionIndex])

  const displayChords = useMemo(() => {
    if (activeChords.length === 0) return activeChords
    return activeChords.map((c) => ({
      ...c,
      chord: transposeChordLabel(c.chord, transposeSemitones, { preferSharps: true }),
    }))
  }, [activeChords, transposeSemitones])

  const chordNamesForMap = useMemo(() => displayChords.map((c) => c.chord).filter(Boolean), [displayChords])

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
  const activeLyrics = useMemo(() => {
    if (!detail) return []
    const hasL = (detail.lyrics?.length ?? 0) > 0
    const hasQL = (detail.quick_lyrics?.length ?? 0) > 0
    if (lyricsMode === 'accurate' && hasL) return detail.lyrics
    if (lyricsMode === 'quick' && hasQL) return detail.quick_lyrics
    // For 'none' or when preferred version isn't available, fall back
    if (hasQL) return detail.quick_lyrics
    return detail.lyrics
  }, [lyricsMode, detail])

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

  const hasLyrics = (detail?.lyrics?.length ?? 0) > 0
  const hasQuickLyrics = (detail?.quick_lyrics?.length ?? 0) > 0
  const hasAnyLyrics = hasLyrics || hasQuickLyrics
  // Tabs disabled.
  const hasTabs = false

  const isJobProcessing =
    detail?.active_job?.status === 'PENDING' || detail?.active_job?.status === 'PROCESSING'

  // Accurate lyrics can arrive after quick lyrics. While they're being generated,
  // keep the toggle visible and show a spinner on the Accurate option.
  const isAccurateLyricsGenerating =
    !!detail && !hasLyrics && hasQuickLyrics && (isJobProcessing || !detail.active_job)

  // When a song loads, pick the best available lyrics mode:
  // accurate > quick > none. This also corrects stale persisted values.
  useEffect(() => {
    if (!detail) return

    if (hasLyrics) {
      setLyricsMode('accurate')
    } else if (hasQuickLyrics) {
      setLyricsMode('quick')
    } else {
      setLyricsMode('none')
    }
  }, [detail, hasLyrics, hasQuickLyrics, setLyricsMode])

  if (isLoading || !detail) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 min-h-[60vh]">
        <div className="h-8 w-8 rounded-full border-2 border-charcoal-600 border-t-flame-400 animate-spin" />
        <span className="text-sm text-smoke-300">{loadingLabel}</span>
      </div>
    )
  }

  const audioUrl = getAudioUrl(songId!, currentStem, detail)
  const hasChords = activeChords.length > 0
  const hasChordSheet = hasChords || hasAnyLyrics

  const showBackgroundProcessing = hasStemsProcessed && hasChords && (!hasAnyLyrics || (sheetMode === 'tabs' && !hasTabs))
  // Only show audio status when stems are processed but the selected stem URL
  // is still loading. Hide it during processing (the checklist covers that).
  const showAudioStatus = !audioUrl && hasStemsProcessed

  const headerTitle = displaySongTitle(detail.song)
  const headerArtist = displayArtistName(detail.song)

  return (
    <div className="relative h-full flex flex-col" data-testid="song-detail-page">
      {/* Background Image */}
      <div
        className="fixed inset-0 bg-cover bg-center bg-no-repeat opacity-20 blur-lg pointer-events-none"
        style={{ backgroundImage: `url("${thumbnailSrc}")` }}
      />

      {/* Fixed top section: song header + player controls */}
      <div className="relative z-30 shrink-0 bg-black overflow-hidden border-b border-charcoal-800/50">
        <div
          className="absolute inset-0 bg-cover bg-center bg-no-repeat opacity-20 blur-md scale-110 pointer-events-none"
          style={{ backgroundImage: `url("${thumbnailSrc}")` }}
        />
        <div className="relative max-w-7xl mx-auto p-3 pb-2 sm:p-4 sm:pb-3 flex flex-col gap-3 sm:gap-4">
          {/* Song header */}
          <div className="relative flex items-center gap-3 sm:gap-4">
            <div className="relative size-12 sm:size-16 lg:size-20 shrink-0 rounded-lg overflow-hidden bg-charcoal-800">
              <img
                src={thumbnailSrc}
                alt=""
                className="w-full h-full object-cover"
                onError={() => songId && markThumbnailFailed(songId)}
              />
              <button
                onClick={handleToggleFavorite}
                className="absolute top-1 right-1 p-1 rounded-full bg-charcoal-900/60 backdrop-blur-sm transition-colors hover:bg-charcoal-900/80"
                data-testid={`favorite-toggle-${songId}`}
                aria-label={isFavorited ? 'Remove from favorites' : 'Add to favorites'}
              >
                <Heart
                  size={14}
                  className={cn(
                    'transition-colors',
                    isFavorited ? 'fill-flame-400 text-flame-400 animate-favorite-ignite' : 'text-smoke-300'
                  )}
                />
              </button>
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h1 className="text-xl sm:text-2xl font-bold leading-tight truncate">{headerTitle}</h1>
                <SongFeedback songId={songId!} />
              </div>
              <p className="text-smoke-400 text-sm sm:text-base truncate">{headerArtist}</p>
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
                onClick={togglePlay}
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
                <div className="h-4 w-4 rounded-full border-2 border-charcoal-600 border-t-flame-400 animate-spin" />
                <span>
                  {currentStem === 'full_mix'
                    ? 'Downloading audio…'
                    : `Preparing ${currentStem.replaceAll('_', ' ')}…`}
                </span>
              </div>
            )}
            <TransportControls
              onTogglePlay={togglePlay}
              onSeek={seek}
              selectors={
                <>
                  <TrackSelector
                    activeStem={currentStem}
                    onStemChange={handleStemChange}
                    availableStems={detail.stems}
                    stemTypes={detail.stem_types}
                  />
                  <ChordOptionSelector chordOptions={detail.chord_options ?? []} hasTabs={hasTabs} />
                  <ChordDisplayControls />
                  {/* Strums button disabled */}
                  <PlaybackSpeedSelector />
                  <LyricsSyncControl />
                  <LyricsVersionToggle
                    hasQuickLyrics={hasQuickLyrics}
                    hasPreciseLyrics={hasLyrics}
                    isPreciseGenerating={isAccurateLyricsGenerating}
                  />
                  <ScrollModeControl />
                  <ChordMapDialog chords={chordNamesForMap} iconOnly />
                </>
              }
            />
          </div>
        </div>
      </div>

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
                    <ChordSheet
                      chords={displayChords}
                      lyrics={activeLyrics}
                      strums={[]}
                      rhythm={null}
                      onSeek={seek}
                    />
                  </div>
                  <div className="hidden lg:flex w-full lg:w-80 lg:shrink-0 min-h-0 flex-col">
                    <ChordMap chords={chordNamesForMap} />
                  </div>
                </div>
              ) : null}
            </>
          )}
        </div>
      </div>

      {/* Lyrics sync debug overlay — toggle with Ctrl+Shift+D */}
      {showLyricsDebug && hasAnyLyrics && (
        <LyricsSyncDebug
          segments={debugNormalizedSegments}
          activeSegmentIndex={debugSync.activeSegmentIndex}
          activeWordIndex={debugSync.activeWordIndex}
          lyricsSource={detail.lyrics_source}
        />
      )}
    </div>
  )
}

import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, Globe, Search, X } from 'lucide-react'
import { SongLibrary } from '@/features/library/components/SongLibrary'
import { UnifiedSearchResults } from '@/features/songs/components/UnifiedSearchResults'
import { SearchPreviewDialog } from '@/features/search/components/SearchPreviewDialog'
import { useSearchSongs } from '@/features/search/hooks/use-search-songs'
import { useRotatingText } from '@/features/search/hooks/use-rotating-text'
import { LevelPicker } from '@/features/songs/components/LevelPicker'
import { ContinueCard } from '@/features/songs/components/ContinueCard'
import { PlanChip } from '@/features/songs/components/PlanChip'
import { TourBackdrop } from '@/features/songs/components/tour/TourBackdrop'
import { WorldSection } from '@/features/songs/components/tour/WorldSection'
import { NextUpRecord } from '@/features/songs/components/tour/NextUpRecord'
import { HitsSection, HitsTeaser } from '@/features/songs/components/tour/HitsSection'
import { TourRail, type TourStop } from '@/features/songs/components/tour/TourRail'
import { BACKSTAGE, STADIUM, worldFor } from '@/features/songs/components/tour/tour-worlds'
import { useActiveStop } from '@/features/songs/hooks/use-tour'
import { usePracticeSummary, useSetSkillLevel } from '@/features/practice/hooks/use-practice-summary'
import { useProAccess } from '@/features/subscription/hooks/use-pro-access'
import { PageContainer } from '@/components/shared/PageContainer'
import { PullToRefreshContainer } from '@/components/shared/PullToRefreshContainer'
import { LoadingSpinner } from '@/components/shared/LoadingSpinner'
import { songsApi } from '@/api/songs.api'
import { queryKeys } from '@/api/query-keys'
import { songDetailPath } from '@/router/routes'
import type { SearchResult } from '@/types/song'
import type { SkillLevel } from '@/types/practice'

const DOWNLOAD_PHRASES = ['Fetching the music…', 'Getting it…', 'Almost there…']
const CATALOG = 'catalog'
const HITS = 'hits'
/** A stop needs enough covers to feel like a place; thinner setlists stay on their own pages. */
const MIN_STOP_SONGS = 4

/** The record for a brand-new user: the easiest song to start with. */
function FirstSongRecord() {
  const { data } = useQuery({
    queryKey: queryKeys.songs.setlist('first-songs', 0, 1),
    queryFn: () => songsApi.setlistSongs('first-songs', { skip: 0, limit: 1 }),
  })
  const song = data?.items[0]
  if (!song) return null
  return <NextUpRecord song={song} progress={null} />
}

/**
 * Home: "Tonight's practice", staged as a night tour. Backstage holds the next
 * song on a record; each setlist below is its own world that the page turns
 * into as you scroll; the full catalog closes the night.
 */
export function SongsPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const onlineSearch = useSearchSongs()
  const { requirePro } = useProAccess()
  const { data: summary } = usePracticeSummary()
  const setSkillLevel = useSetSkillLevel()
  const { active, observe } = useActiveStop(BACKSTAGE.scene)
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [hasSearchedOnline, setHasSearchedOnline] = useState(false)
  const [selectingYoutubeId, setSelectingYoutubeId] = useState<string | null>(null)
  const [previewResult, setPreviewResult] = useState<SearchResult | null>(null)
  const downloadLabel = useRotatingText(DOWNLOAD_PHRASES, !!selectingYoutubeId)
  const level = setSkillLevel.variables ?? summary?.skill_level ?? null

  const setlists = useQuery({
    queryKey: queryKeys.songs.setlists(level),
    queryFn: () => songsApi.setlists(level),
    // Changing level reorders the same setlists; keep them on screen meanwhile.
    placeholderData: (previous) => previous,
  })

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), 300)
    return () => clearTimeout(timer)
  }, [query])

  const selectSong = useMutation({
    mutationFn: (result: SearchResult) =>
      songsApi.select(`${result.artist}/${result.song}`, result.youtube_id),
    onSuccess: (detail) => {
      setSelectingYoutubeId(null)
      setPreviewResult(null)
      queryClient.setQueryData(queryKeys.songs.detail(detail.song.id), detail)
      navigate(songDetailPath(detail.song.id))
    },
    onError: () => {
      setSelectingYoutubeId(null)
      setPreviewResult(null)
    },
  })

  const handleQueryChange = (value: string) => {
    setQuery(value)
    // Editing the query invalidates any previously fetched web results.
    if (hasSearchedOnline) {
      setHasSearchedOnline(false)
      onlineSearch.reset()
    }
  }

  const handleSearchOnline = () => {
    if (!query.trim()) return
    if (!requirePro('add_song')) return
    setHasSearchedOnline(true)
    onlineSearch.mutate(query.trim())
  }

  const handleSelect = (result: SearchResult) => {
    // Already-processed songs go straight to their page; web results that still
    // need downloading open a preview first so the user can confirm the match
    // before triggering the heavy processing pipeline.
    if (result.exists_locally && result.song_id) {
      navigate(songDetailPath(result.song_id))
    } else {
      setPreviewResult(result)
    }
  }

  const handleConfirmDownload = (result: SearchResult) => {
    setSelectingYoutubeId(result.youtube_id)
    selectSong.mutate(result)
  }

  const handleClear = () => {
    setQuery('')
    setHasSearchedOnline(false)
    onlineSearch.reset()
  }

  const handleLevel = (next: SkillLevel) => setSkillLevel.mutate(next)

  const continueSongs = summary?.continue_songs ?? []
  const [nextUp, ...alsoInProgress] = continueSongs
  // Charts get their own stadium stop; themed setlists each become a world.
  const tourStops = (setlists.data ?? []).filter((s) => s.kind !== 'chart' && s.song_count >= MIN_STOP_SONGS)
  const stops: TourStop[] = [
    { id: BACKSTAGE.scene, label: BACKSTAGE.place, accent: BACKSTAGE.accent },
    { id: HITS, label: STADIUM.place, accent: STADIUM.accent },
    ...tourStops.map((s) => ({ id: s.id, label: worldFor(s.id).place, accent: worldFor(s.id).accent })),
    { id: CATALOG, label: 'Encore', accent: BACKSTAGE.accent },
  ]
  const isSearching = !!debouncedQuery
  const scene = isSearching || active === BACKSTAGE.scene || active === CATALOG
    ? 'backstage'
    : active === HITS ? STADIUM.scene : worldFor(active).scene

  const jumpTo = (id: string) => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    document.querySelector(`[data-stop="${id}"]`)?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' })
  }

  return (
    <div className="relative flex h-full flex-col overflow-hidden bg-stage-950" data-testid="songs-page">
      <TourBackdrop active={scene} />

      <PullToRefreshContainer
        className="relative z-10 flex-1 min-h-0 overflow-y-auto pb-[calc(5rem+env(safe-area-inset-bottom)+var(--vv-bottom-offset))] lg:pb-0"
        queryKeys={[queryKeys.songs.all, queryKeys.practice.all]}
      >
        <header className="sticky top-0 z-40 px-3 pt-3 sm:px-6">
          <div className="mx-auto flex max-w-4xl items-center gap-2 rounded-full border border-white/10 bg-stage-950/75 p-1.5 pl-4 shadow-[0_18px_50px_rgba(0,0,0,0.45)] backdrop-blur-xl">
            <Search size={16} className="shrink-0 text-smoke-400" aria-hidden="true" />
            <input
              type="text"
              value={query}
              onChange={(e) => handleQueryChange(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearchOnline()}
              placeholder="Find a song or artist…"
              aria-label="Search by song or artist"
              className="min-w-0 flex-1 bg-transparent py-2 text-sm text-smoke-100 placeholder:text-smoke-500 focus:outline-none"
              data-testid="songs-search-input"
            />
            {query && (
              <button
                type="button"
                onClick={handleClear}
                className="grid size-8 shrink-0 place-items-center rounded-full text-smoke-400 transition-colors hover:bg-white/10 hover:text-smoke-200"
                aria-label="Clear search"
                data-testid="songs-search-clear-button"
              >
                <X size={15} />
              </button>
            )}
            <button
              type="button"
              onClick={handleSearchOnline}
              disabled={!query.trim() || onlineSearch.isPending}
              className="flex shrink-0 items-center gap-1.5 rounded-full bg-fire-500/15 px-3 py-2 text-xs font-bold text-fire-300 transition-colors hover:bg-fire-500/25 disabled:cursor-not-allowed disabled:opacity-50"
              aria-label="Search YouTube for any song"
              title="Add any song from YouTube (about 5 minutes)"
              data-testid="songs-search-online-button"
            >
              {onlineSearch.isPending ? <LoadingSpinner size="xs" inline /> : <Globe size={15} aria-hidden="true" />}
              <span className="hidden sm:inline">Add any song</span>
            </button>
            <span className="hidden sm:contents">
              <PlanChip />
            </span>
          </div>
        </header>

        {selectSong.isError && (
          <PageContainer className="py-3">
            <div className="rounded-lg border border-red-500/40 bg-red-950/40 px-3 py-2 text-sm text-red-300" aria-live="assertive">
              Could not download song. Please try again later.
            </div>
          </PageContainer>
        )}

        {isSearching ? (
          <PageContainer>
            <UnifiedSearchResults
              query={debouncedQuery}
              onlineResults={onlineSearch.data || []}
              hasSearchedOnline={hasSearchedOnline}
              isOnlineLoading={onlineSearch.isPending}
              onSearchOnline={handleSearchOnline}
              onSelectOnline={handleSelect}
              isSelecting={selectSong.isPending}
              selectingYoutubeId={selectingYoutubeId}
              downloadLabel={downloadLabel}
            />
          </PageContainer>
        ) : (
          <>
            <section
              ref={observe(BACKSTAGE.scene)}
              data-stop={BACKSTAGE.scene}
              data-inview="true"
              className="relative flex min-h-[calc(94svh-4.5rem)] items-center pb-16 pt-8 sm:py-14"
              aria-labelledby="tonight-title"
            >
              <div className="mx-auto grid w-full max-w-6xl items-center gap-8 px-5 sm:px-8 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:grid-rows-[auto_auto] lg:gap-x-14 lg:gap-y-8">
                <div className="lg:col-start-1 lg:row-start-1 lg:self-end">
                  <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.3em] text-flame-300">
                    {new Date().toLocaleDateString('en-US', { weekday: 'long' })} · backstage
                  </p>
                  <h1 id="tonight-title" className="mt-3 font-display text-[clamp(3.6rem,13vw,9.5rem)] leading-[0.8] tracking-wide text-smoke-100">
                    <span className="block">TONIGHT&apos;S</span>{' '}
                    <span className="block text-fire-500 [text-shadow:0_0_60px_rgba(249,115,22,0.45)]">PRACTICE</span>
                  </h1>
                  <p className="mt-4 max-w-md text-[15px] leading-relaxed text-smoke-200 sm:mt-5 sm:text-lg">
                    Pick a song you love. The band plays it with you. Mute the guitar and play it yourself.
                  </p>
                  <div className="mt-4 flex flex-wrap items-center gap-2 empty:hidden sm:mt-5">
                    {summary && summary.streak_days > 0 && (
                      <span className="rounded-full border border-flame-400/30 bg-flame-400/10 px-3 py-1 text-xs font-bold text-flame-300" data-testid="streak-chip">
                        🔥 {summary.streak_days}-day streak
                      </span>
                    )}
                    <span className="sm:hidden">
                      <PlanChip />
                    </span>
                  </div>
                </div>

                <div className="lg:col-start-2 lg:row-span-2 lg:row-start-1" data-testid="continue-section">
                  {nextUp ? <NextUpRecord song={nextUp.song} progress={nextUp.progress} /> : summary && <FirstSongRecord />}
                  {alsoInProgress.length > 0 && (
                    <div className="mt-8">
                      <p className="mb-2 font-mono text-[11px] uppercase tracking-[0.24em] text-smoke-400">Also on your music stand</p>
                      <div className="grid gap-2.5 sm:grid-cols-2">
                        {alsoInProgress.map((item) => <ContinueCard key={item.song.id} item={item} />)}
                      </div>
                    </div>
                  )}
                </div>

                <div className="flex flex-col gap-6 lg:col-start-1 lg:row-start-2 lg:self-start">
                  <div>
                    <p className="mb-2 text-xs font-semibold text-smoke-300">Where are you on guitar?</p>
                    <LevelPicker value={level} onChange={handleLevel} />
                  </div>
                  <div>
                    <HitsTeaser onJump={() => jumpTo(HITS)} />
                  </div>
                </div>
              </div>

              {tourStops.length > 0 && (
                <button
                  type="button"
                  onClick={() => jumpTo(HITS)}
                  className="absolute bottom-5 left-1/2 flex -translate-x-1/2 flex-col items-center gap-1 font-mono text-[10px] uppercase tracking-[0.28em] text-smoke-400 transition-colors hover:text-smoke-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-flame-400/70"
                  data-testid="tour-start-button"
                >
                  {tourStops.length + 1} stops tonight
                  <ChevronDown size={18} className="animate-bounce motion-reduce:animate-none" aria-hidden="true" />
                </button>
              )}
            </section>

            <HitsSection observe={observe(HITS)} />

            {tourStops.map((setlist, i) => (
              <WorldSection
                key={setlist.id}
                setlist={setlist}
                world={worldFor(setlist.id)}
                stop={i + 2}
                observe={observe(setlist.id)}
              />
            ))}

            <section ref={observe(CATALOG)} data-stop={CATALOG} className="relative py-20" aria-labelledby="catalog-title">
              <div className="mx-auto w-full max-w-5xl px-5 sm:px-8">
                <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.3em] text-flame-300">Encore · every song</p>
                <h2 id="catalog-title" className="mt-3 font-display text-6xl leading-[0.88] tracking-wide text-smoke-100 sm:text-7xl">
                  THE WHOLE CATALOG
                </h2>
                <p className="mt-3 max-w-xl text-smoke-300">
                  Every song here is ready to play right now. Not here? Search above and add it from YouTube — it’s ready in about 5 minutes.
                </p>
                <div className="mt-8">
                  <SongLibrary />
                </div>
              </div>
            </section>
          </>
        )}
      </PullToRefreshContainer>

      {!isSearching && <TourRail stops={stops} active={active} onJump={jumpTo} />}

      <SearchPreviewDialog
        result={previewResult}
        onClose={() => setPreviewResult(null)}
        onConfirm={handleConfirmDownload}
        isDownloading={selectSong.isPending}
        downloadLabel={downloadLabel}
      />
    </div>
  )
}

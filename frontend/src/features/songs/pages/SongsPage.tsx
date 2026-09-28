import { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Globe, X } from 'lucide-react'
import { SongLibrary } from '@/features/library/components/SongLibrary'
import { UnifiedSearchResults } from '@/features/songs/components/UnifiedSearchResults'
import { SearchPreviewDialog } from '@/features/search/components/SearchPreviewDialog'
import { useSearchSongs } from '@/features/search/hooks/use-search-songs'
import { useRotatingText } from '@/features/search/hooks/use-rotating-text'
import { LevelPicker } from '@/features/songs/components/LevelPicker'
import { ContinueCard } from '@/features/songs/components/ContinueCard'
import { SetlistGrid } from '@/features/songs/components/SetlistGrid'
import { PlanChip } from '@/features/songs/components/PlanChip'
import { usePracticeSummary, useSetSkillLevel } from '@/features/practice/hooks/use-practice-summary'
import { useProAccess } from '@/features/subscription/hooks/use-pro-access'
import { PageContainer } from '@/components/shared/PageContainer'
import { PullToRefreshContainer } from '@/components/shared/PullToRefreshContainer'
import { LoadingSpinner } from '@/components/shared/LoadingSpinner'
import { songsApi } from '@/api/songs.api'
import { queryKeys } from '@/api/query-keys'
import { songDetailPath } from '@/router/routes'
import { displaySongTitle, displayArtistName } from '@/lib/format-song'
import type { SearchResult } from '@/types/song'
import type { SkillLevel } from '@/types/practice'

const DOWNLOAD_PHRASES = ['Fetching the music…', 'Getting it…', 'Almost there…']

interface SectionTitleProps {
  title: string
  aside?: React.ReactNode
}

function SectionTitle({ title, aside }: SectionTitleProps) {
  return (
    <div className="mb-2.5 flex items-baseline justify-between gap-3">
      <h2 className="font-display text-xl tracking-wide text-smoke-100">{title}</h2>
      {aside}
    </div>
  )
}

/** Suggests the very first song when the user has nothing in progress yet. */
function FirstSongCard() {
  const { data } = useQuery({
    queryKey: queryKeys.songs.setlist('first-songs', 0),
    queryFn: () => songsApi.setlistSongs('first-songs', { skip: 0, limit: 1 }),
  })
  const song = data?.items[0]
  if (!song) return null

  return (
    <Link
      to={songDetailPath(song.id)}
      className="block rounded-2xl bg-paper-50 p-4 text-ink-900 shadow-[0_14px_38px_rgba(0,0,0,0.3)] transition-transform hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-flame-400/70"
      data-testid="first-song-card"
    >
      <p className="text-[10px] font-extrabold tracking-[0.12em] text-fire-600">START HERE · YOUR FIRST SONG</p>
      <p className="mt-1 font-serif text-xl font-extrabold leading-tight">{displaySongTitle(song)}</p>
      <p className="text-sm text-ink-600">{displayArtistName(song)}</p>
      {(song.easy_chords?.length ?? 0) > 0 && (
        <p className="mt-2 font-mono text-xs font-bold text-ink-600" dir="ltr">
          {song.easy_chords?.join(' · ')}{song.easy_capo ? ` · capo ${song.easy_capo}` : ''}
        </p>
      )}
      <p className="mt-2 text-xs text-ink-600">Step 1: hear the guitar part on its own →</p>
    </Link>
  )
}

/**
 * Home: "Tonight's practice". Picks up songs in progress, offers setlists for
 * the user's level, and searches the library (or YouTube, for Pro).
 */
export function SongsPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const onlineSearch = useSearchSongs()
  const { requirePro } = useProAccess()
  const { data: summary } = usePracticeSummary()
  const setSkillLevel = useSetSkillLevel()
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

  return (
    <div className="relative flex h-full flex-col overflow-hidden bg-stage-950" data-testid="songs-page">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-72 bg-[radial-gradient(90%_100%_at_50%_-20%,rgba(249,115,22,0.32)_0%,rgba(124,45,18,0.16)_45%,transparent_75%)]" aria-hidden="true" />
      <div className="relative z-20 shrink-0 border-b border-white/10 bg-stage-950/70 backdrop-blur-2xl">
        <div className="mx-auto max-w-5xl px-4 pb-4 pt-5">
          <div className="flex items-center justify-between gap-3">
            <h1 className="font-display text-[2.1rem] leading-none tracking-wide text-smoke-100">TONIGHT&apos;S PRACTICE</h1>
            <div className="flex shrink-0 items-center gap-2">
              <PlanChip />
              {summary && summary.streak_days > 0 && (
                <span className="rounded-full border border-flame-400/30 bg-flame-400/10 px-2.5 py-1 text-[11px] font-bold text-flame-300" data-testid="streak-chip">
                  🔥 {summary.streak_days}-day streak
                </span>
              )}
            </div>
          </div>
          <div className="mt-3 flex items-stretch gap-2">
            <div className="relative flex-1">
              <input
                type="text"
                value={query}
                onChange={(e) => handleQueryChange(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSearchOnline()}
                placeholder="Find a song or artist…"
                aria-label="Search by song or artist"
                className="w-full rounded-xl border border-white/10 bg-white/[0.05] py-3 pl-4 pr-10 text-smoke-100 placeholder:text-smoke-500 transition-shadow focus:outline-none focus:ring-2 focus:ring-fire-500"
                data-testid="songs-search-input"
              />
              {query && (
                <button
                  type="button"
                  onClick={handleClear}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-smoke-500 transition-colors hover:text-smoke-300"
                  aria-label="Clear search"
                  data-testid="songs-search-clear-button"
                >
                  <X size={16} />
                </button>
              )}
            </div>
            <button
              type="button"
              onClick={handleSearchOnline}
              disabled={!query.trim() || onlineSearch.isPending}
              className="flex shrink-0 items-center justify-center gap-1.5 rounded-xl border border-fire-500/40 bg-fire-500/15 px-3 text-xs font-bold text-fire-300 transition-colors hover:bg-fire-500/25 disabled:cursor-not-allowed disabled:opacity-50"
              aria-label="Search YouTube for any song"
              title="Add any song from YouTube (about 5 minutes)"
              data-testid="songs-search-online-button"
            >
              {onlineSearch.isPending ? <LoadingSpinner size="xs" inline /> : <Globe size={16} aria-hidden="true" />}
              <span className="hidden sm:inline">Add any song</span>
            </button>
          </div>
        </div>
      </div>
      <PullToRefreshContainer
        className="relative flex-1 min-h-0 overflow-y-auto pb-[calc(5rem+env(safe-area-inset-bottom)+var(--vv-bottom-offset))] lg:pb-0"
        queryKeys={[queryKeys.songs.all, queryKeys.practice.all]}
      >
        <PageContainer>
          {selectSong.isError && (
            <div
              className="mb-3 rounded-lg border border-red-500/40 bg-red-950/40 px-3 py-2 text-sm text-red-300"
              aria-live="assertive"
            >
              Could not download song. Please try again later.
            </div>
          )}

          {debouncedQuery ? (
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
          ) : (
            <div className="space-y-7">
              <section aria-label="Your level">
                <p className="mb-2 text-xs font-semibold text-smoke-400">Where are you on guitar?</p>
                <LevelPicker value={level} onChange={handleLevel} />
              </section>

              <section data-testid="continue-section">
                <SectionTitle title={continueSongs.length ? 'PICK UP WHERE YOU LEFT OFF' : 'YOUR FIRST SONG'} />
                {continueSongs.length ? (
                  <div className="grid gap-2.5 sm:grid-cols-2">
                    {continueSongs.map((item) => <ContinueCard key={item.song.id} item={item} />)}
                  </div>
                ) : (
                  summary && <FirstSongCard />
                )}
              </section>

              <section>
                <SectionTitle title="SETLISTS FOR YOU" />
                <SetlistGrid setlists={setlists.data} isLoading={setlists.isLoading} />
              </section>

              <section>
                <SectionTitle
                  title="ALL SONGS"
                  aside={<span className="text-[11px] text-smoke-500">ready to play instantly</span>}
                />
                <SongLibrary />
              </section>
            </div>
          )}
        </PageContainer>
      </PullToRefreshContainer>

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

import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Music, Globe, X } from 'lucide-react'
import { SongLibrary } from '@/features/library/components/SongLibrary'
import { RecentSongs } from '@/features/library/components/RecentSongs'
import { UnifiedSearchResults } from '@/features/songs/components/UnifiedSearchResults'
import { SearchPreviewDialog } from '@/features/search/components/SearchPreviewDialog'
import { useSearchSongs } from '@/features/search/hooks/use-search-songs'
import { useRotatingText } from '@/features/search/hooks/use-rotating-text'
import { SectionHeading } from '@/components/shared/SectionHeading'
import { PageBackground } from '@/components/shared/PageBackground'
import { PageHeader } from '@/components/shared/PageHeader'
import { PageContainer } from '@/components/shared/PageContainer'
import { PullToRefreshContainer } from '@/components/shared/PullToRefreshContainer'
import { LoadingSpinner } from '@/components/shared/LoadingSpinner'
import { songsApi } from '@/api/songs.api'
import { queryKeys } from '@/api/query-keys'
import { songDetailPath } from '@/router/routes'
import type { SearchResult } from '@/types/song'

const DOWNLOAD_PHRASES = ['Fetching the music…', 'Getting it…', 'Almost there…']

export function SongsPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const onlineSearch = useSearchSongs()
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [hasSearchedOnline, setHasSearchedOnline] = useState(false)
  const [selectingYoutubeId, setSelectingYoutubeId] = useState<string | null>(null)
  const [previewResult, setPreviewResult] = useState<SearchResult | null>(null)
  const downloadLabel = useRotatingText(DOWNLOAD_PHRASES, !!selectingYoutubeId)

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

  return (
    <div className="relative h-full flex flex-col overflow-hidden" data-testid="songs-page">
      <PageBackground />
      <div className="shrink-0">
        <PageHeader title="Songs" icon={<Music size={24} />} subtitle="Search and browse the collection">
          <div className="flex items-stretch gap-2">
            <div className="relative flex-1">
              <input
                type="text"
                value={query}
                onChange={(e) => handleQueryChange(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSearchOnline()}
                placeholder="Search by song or artist…"
                aria-label="Search by song or artist"
                className="w-full pl-4 pr-10 py-3 bg-charcoal-700 border border-charcoal-600 rounded-xl text-smoke-100 placeholder:text-smoke-600 focus:outline-none focus:ring-2 focus:ring-flame-400 transition-shadow"
                data-testid="songs-search-input"
              />
              {query && (
                <button
                  type="button"
                  onClick={handleClear}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-smoke-500 hover:text-smoke-300 transition-colors"
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
              className="flex w-12 shrink-0 items-center justify-center bg-flame-400/20 border border-flame-400/40 hover:bg-flame-400/30 disabled:opacity-50 disabled:cursor-not-allowed text-flame-300 rounded-xl transition-colors"
              aria-label="Search online"
              title="Search online"
              data-testid="songs-search-online-button"
            >
              {onlineSearch.isPending ? (
                <LoadingSpinner size="xs" inline />
              ) : (
                <Globe size={18} />
              )}
            </button>
          </div>
        </PageHeader>
      </div>
      <PullToRefreshContainer
        className="flex-1 min-h-0 overflow-y-auto pb-[calc(5rem+env(safe-area-inset-bottom)+var(--vv-bottom-offset))] lg:pb-0"
        queryKeys={[queryKeys.songs.all]}
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
            <>
              <section className="mb-8">
                <SectionHeading title="Recently Added" />
                <RecentSongs />
              </section>
              <section>
                <SectionHeading title="All Songs" />
                <SongLibrary />
              </section>
            </>
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

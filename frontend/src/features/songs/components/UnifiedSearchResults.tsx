import { Globe, Search } from 'lucide-react'
import { useSongs } from '@/features/library/hooks/use-songs'
import { SongCard } from '@/features/library/components/SongCard'
import { SearchResultCard } from '@/features/search/components/SearchResultCard'
import { Skeleton } from '@/components/shared/Skeleton'
import { EmptyState } from '@/components/shared/EmptyState'
import { LoadingSpinner } from '@/components/shared/LoadingSpinner'
import type { SearchResult } from '@/types/song'

const LIBRARY_LIMIT = 20

interface UnifiedSearchResultsProps {
  query: string
  onlineResults: SearchResult[]
  hasSearchedOnline: boolean
  isOnlineLoading: boolean
  onSearchOnline: () => void
  onSelectOnline: (result: SearchResult) => void
  isSelecting?: boolean
  selectingYoutubeId?: string | null
  downloadLabel?: string
}

/**
 * Single, unified result list for an active search query. Library matches
 * (already downloaded songs) render first as instant-navigation cards; web
 * results are appended into the same list once the user presses search.
 * Web results that already exist locally are deduped against the displayed
 * library songs so a song never shows up twice.
 */
export function UnifiedSearchResults({
  query,
  onlineResults,
  hasSearchedOnline,
  isOnlineLoading,
  onSearchOnline,
  onSelectOnline,
  isSelecting,
  selectingYoutubeId,
  downloadLabel,
}: UnifiedSearchResultsProps) {
  const { data, isLoading } = useSongs(query, 0, LIBRARY_LIMIT)

  const librarySongs = data?.items ?? []
  const libraryIds = new Set(librarySongs.map((song) => song.id))
  const webResults = onlineResults.filter((result) => !result.song_id || !libraryIds.has(result.song_id))

  // First load for this query (nothing cached yet) — show skeletons.
  if (isLoading && !data) {
    return (
      <div className="grid grid-cols-1 gap-3" data-testid="songs-results">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-16 rounded-xl" />
        ))}
      </div>
    )
  }

  const hasLibrary = librarySongs.length > 0
  const showOnlinePrompt = !hasLibrary && !hasSearchedOnline && !isOnlineLoading
  const showNoResults = !hasLibrary && hasSearchedOnline && !isOnlineLoading && webResults.length === 0
  const showNoExtraWeb = hasLibrary && hasSearchedOnline && !isOnlineLoading && webResults.length === 0

  return (
    <div className="flex flex-col gap-3" data-testid="songs-results">
      {librarySongs.map((song) => (
        <SongCard key={song.id} song={song} />
      ))}

      {hasLibrary && webResults.length > 0 && (
        <div className="flex items-center gap-3 pt-2" aria-hidden="true">
          <span className="h-px flex-1 bg-charcoal-700/50" />
          <span className="text-xs font-medium uppercase tracking-wider text-smoke-500">More from the web</span>
          <span className="h-px flex-1 bg-charcoal-700/50" />
        </div>
      )}

      {webResults.map((result) => (
        <SearchResultCard
          key={result.youtube_id}
          result={result}
          onSelect={onSelectOnline}
          isSelecting={isSelecting}
          isActive={!!selectingYoutubeId && selectingYoutubeId === result.youtube_id}
          downloadLabel={downloadLabel}
        />
      ))}

      {isOnlineLoading && (
        <div
          className="flex items-center justify-center gap-2 py-4 text-sm text-smoke-400"
          aria-live="polite"
          data-testid="songs-online-loading"
        >
          <LoadingSpinner size="xs" inline />
          <span>Searching the web…</span>
        </div>
      )}

      {showNoExtraWeb && (
        <p className="py-2 text-center text-xs text-smoke-500">No additional results from the web.</p>
      )}

      {showOnlinePrompt && (
        <div data-testid="songs-search-online-prompt">
          <EmptyState
            icon={<Search size={48} />}
            title={`Nothing in your library for “${query}”`}
            description="Search the web to find this song and add it to your library."
            action={
              <button
                type="button"
                onClick={onSearchOnline}
                className="flex items-center gap-2 px-4 py-2 bg-flame-400/20 border border-flame-400/40 hover:bg-flame-400/30 text-flame-300 font-medium rounded-xl transition-colors"
                data-testid="songs-search-online-cta"
              >
                <Globe size={16} />
                <span>Search online</span>
              </button>
            }
          />
        </div>
      )}

      {showNoResults && (
        <EmptyState
          icon={<Search size={48} />}
          title={`No results for “${query}”`}
          description="Try a different search term."
        />
      )}
    </div>
  )
}

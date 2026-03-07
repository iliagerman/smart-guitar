import type { SearchResult } from '@/types/song'
import { SearchResultCard } from './SearchResultCard'
import { EmptyState } from '@/components/shared/EmptyState'
import { Search } from 'lucide-react'

interface SearchResultsProps {
  results: SearchResult[]
  onSelect: (result: SearchResult) => void
  isSelecting?: boolean
  selectingYoutubeId?: string | null
  hasSearched: boolean
  query?: string
  isLoading?: boolean
  downloadLabel?: string
}

export function SearchResults({
  results,
  onSelect,
  isSelecting,
  selectingYoutubeId,
  hasSearched,
  query,
  isLoading,
  downloadLabel,
}: SearchResultsProps) {
  if (!hasSearched) return null

  if (isLoading) {
    return (
      <EmptyState
        icon={<Search size={48} />}
        title={query ? `“${query}”` : 'Searching…'}
        description={query ? 'Searching…' : undefined}
        action={
          <div
            className="h-5 w-5 rounded-full border-2 border-charcoal-600 border-t-flame-400 animate-spin"
            aria-label="Searching"
          />
        }
      />
    )
  }

  if (results.length === 0) {
    return (
      <EmptyState
        icon={<Search size={48} />}
        title={query ? `No results for “${query}”` : 'No results found'}
        description="Try a different search query"
      />
    )
  }

  return (
    <div className="flex flex-col gap-3" data-testid="search-results">
      {results.map((result) => (
        <SearchResultCard
          key={result.youtube_id}
          result={result}
          onSelect={onSelect}
          isSelecting={isSelecting}
          isActive={!!selectingYoutubeId && selectingYoutubeId === result.youtube_id}
          downloadLabel={downloadLabel}
        />
      ))}
    </div>
  )
}

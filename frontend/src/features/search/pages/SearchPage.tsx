import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation } from '@tanstack/react-query'
import { Search } from 'lucide-react'
import { SearchBar } from '../components/SearchBar'
import { SearchResults } from '../components/SearchResults'
import { useSearchSongs } from '../hooks/use-search-songs'
import { useRotatingText } from '../hooks/use-rotating-text'
import { songsApi } from '@/api/songs.api'
import { songDetailPath } from '@/router/routes'
import { PageBackground } from '@/components/shared/PageBackground'
import { PageHeader } from '@/components/shared/PageHeader'
import { PageContainer } from '@/components/shared/PageContainer'
import type { SearchResult } from '@/types/song'

const DOWNLOAD_PHRASES = ['Fetching the music…', 'Getting it…', 'Almost there…']

export function SearchPage() {
  const navigate = useNavigate()
  const search = useSearchSongs()
  const [hasSearched, setHasSearched] = useState(false)
  const [searchQuery, setSearchQuery] = useState<string>('')
  const [selectingYoutubeId, setSelectingYoutubeId] = useState<string | null>(null)
  const downloadLabel = useRotatingText(DOWNLOAD_PHRASES, !!selectingYoutubeId)

  const selectSong = useMutation({
    mutationFn: (result: SearchResult) =>
      songsApi.select(`${result.artist}/${result.song}`, result.youtube_id),
    onSuccess: (detail) => {
      setSelectingYoutubeId(null)
      navigate(songDetailPath(detail.song.id))
    },
    onError: () => {
      setSelectingYoutubeId(null)
    },
  })

  const handleSearch = (query: string) => {
    setHasSearched(true)
    setSearchQuery(query)
    search.mutate(query)
  }

  const handleSelect = (result: SearchResult) => {
    if (result.exists_locally && result.song_id) {
      navigate(songDetailPath(result.song_id))
    } else {
      setSelectingYoutubeId(result.youtube_id)
      selectSong.mutate(result)
    }
  }

  return (
    <div className="relative min-h-full flex flex-col" data-testid="search-page">
      <PageBackground />
      <PageHeader title="Search" icon={<Search size={24} />}>
        <SearchBar onSearch={handleSearch} isLoading={search.isPending} />
      </PageHeader>
      <PageContainer>
        {selectSong.isPending && (
          <div
            className="mb-3 flex items-center gap-2 rounded-lg border border-charcoal-700/50 bg-charcoal-900/40 backdrop-blur-sm px-3 py-2 text-sm text-smoke-300"
            aria-live="polite"
          >
            <div className="h-4 w-4 rounded-full border-2 border-charcoal-600 border-t-flame-400 animate-spin" />
            <span>{downloadLabel}</span>
          </div>
        )}
        {selectSong.isError && (
          <div
            className="mb-3 rounded-lg border border-red-500/40 bg-red-950/40 px-3 py-2 text-sm text-red-300"
            aria-live="assertive"
          >
            Could not download song. Please try again later.
          </div>
        )}
        <SearchResults
          results={search.data || []}
          onSelect={handleSelect}
          isSelecting={selectSong.isPending}
          selectingYoutubeId={selectingYoutubeId}
          hasSearched={hasSearched}
          query={searchQuery}
          isLoading={search.isPending}
          downloadLabel={downloadLabel}
        />
      </PageContainer>
    </div>
  )
}

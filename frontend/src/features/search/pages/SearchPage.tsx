import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Search } from 'lucide-react'
import { SearchBar } from '../components/SearchBar'
import { SearchResults } from '../components/SearchResults'
import { useSearchSongs } from '../hooks/use-search-songs'
import { useRotatingText } from '../hooks/use-rotating-text'
import { songsApi } from '@/api/songs.api'
import { queryKeys } from '@/api/query-keys'
import { songDetailPath } from '@/router/routes'
import { PageBackground } from '@/components/shared/PageBackground'
import { PageHeader } from '@/components/shared/PageHeader'
import { PageContainer } from '@/components/shared/PageContainer'
import type { SearchResult } from '@/types/song'

const DOWNLOAD_PHRASES = ['Fetching the music…', 'Getting it…', 'Almost there…']

export function SearchPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
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
      queryClient.setQueryData(queryKeys.songs.detail(detail.song.id), detail)
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
    <div className="relative h-full flex flex-col overflow-hidden" data-testid="search-page">
      <PageBackground />
      <div className="shrink-0">
        <PageHeader title="Search" icon={<Search size={24} />}>
          <SearchBar onSearch={handleSearch} isLoading={search.isPending} />
        </PageHeader>
      </div>
      <PageContainer className="flex-1 min-h-0 overflow-y-auto pb-[calc(5rem+env(safe-area-inset-bottom)+var(--vv-bottom-offset))] lg:pb-0">
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

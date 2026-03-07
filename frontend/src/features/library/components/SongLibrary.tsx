import { useState } from 'react'
import { useSongs } from '../hooks/use-songs'
import { SongCard } from './SongCard'
import { Skeleton } from '@/components/shared/Skeleton'
import { EmptyState } from '@/components/shared/EmptyState'
import { Pagination } from '@/components/shared/Pagination'
import { Music, Search } from 'lucide-react'

const PAGE_SIZE = 20

interface SongLibraryProps {
  query?: string
}

export function SongLibrary({ query }: SongLibraryProps) {
  return <SongLibraryInner key={query ?? '__all__'} query={query} />
}

function SongLibraryInner({ query }: SongLibraryProps) {
  const [offset, setOffset] = useState(0)
  const { data, isLoading } = useSongs(query, offset, PAGE_SIZE)

  if (isLoading && !data) {
    return (
      <div className="grid grid-cols-1 gap-3">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-16 rounded-xl" />
        ))}
      </div>
    )
  }

  const songs = data?.items ?? []
  const total = data?.total ?? 0

  if (!songs.length) {
    return (
      <EmptyState
        icon={query ? <Search size={48} /> : <Music size={48} />}
        title={query ? 'No matches found' : 'No songs yet'}
        description={query ? 'Try a different search term' : 'Search and add songs to build your library'}
      />
    )
  }

  return (
    <div>
      <div className="grid grid-cols-1 gap-3" data-testid="song-library">
        {songs.map((song) => (
          <SongCard key={song.id} song={song} />
        ))}
      </div>
      <Pagination offset={offset} limit={PAGE_SIZE} total={total} onPageChange={setOffset} />
    </div>
  )
}

import { useState, useMemo } from 'react'
import { useFavorites } from '../hooks/use-favorites'
import { SongCard } from './SongCard'
import { Skeleton } from '@/components/shared/Skeleton'
import { EmptyState } from '@/components/shared/EmptyState'
import { Pagination } from '@/components/shared/Pagination'
import { Heart, Search } from 'lucide-react'

const PAGE_SIZE = 20

interface FavoritesListProps {
  query?: string
}

export function FavoritesList({ query }: FavoritesListProps) {
  return <FavoritesListInner key={query ?? '__all__'} query={query} />
}

function FavoritesListInner({ query }: FavoritesListProps) {
  const [offset, setOffset] = useState(0)
  const { data: favorites, isLoading } = useFavorites()

  const filtered = useMemo(() => {
    if (!favorites) return []
    if (!query) return favorites
    const q = query.toLowerCase()
    return favorites.filter(
      (fav) =>
        fav.song?.title.toLowerCase().includes(q) ||
        fav.song?.artist?.toLowerCase().includes(q),
    )
  }, [favorites, query])

  const page = filtered.slice(offset, offset + PAGE_SIZE)
  const total = filtered.length

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-16 rounded-xl" />
        ))}
      </div>
    )
  }

  if (!favorites?.length) {
    return (
      <EmptyState
        icon={<Heart size={48} />}
        title="No favorites yet"
        description="Heart your favorite songs to see them here"
      />
    )
  }

  if (query && !page.length) {
    return (
      <EmptyState
        icon={<Search size={48} />}
        title="No matches found"
        description="Try a different search term"
      />
    )
  }

  return (
    <div>
      <div className="grid grid-cols-1 gap-3" data-testid="favorites-list">
        {page.map((fav) =>
          fav.song ? <SongCard key={fav.id} song={fav.song} /> : null,
        )}
      </div>
      <Pagination offset={offset} limit={PAGE_SIZE} total={total} onPageChange={setOffset} />
    </div>
  )
}

import { useState, useMemo, useRef } from 'react'
import { useFavorites } from '../hooks/use-favorites'
import { sortFavorites } from '../lib/sort-favorites'
import { SongCard } from './SongCard'
import { Skeleton } from '@/components/shared/Skeleton'
import { EmptyState } from '@/components/shared/EmptyState'
import { Pagination } from '@/components/shared/Pagination'
import { getScrollableParent } from '@/lib/scroll'
import { useFavoritesSortStore } from '@/stores/favorites-sort.store'
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
  const rootRef = useRef<HTMLDivElement>(null)
  const { data: favorites, isLoading } = useFavorites()
  const sortMode = useFavoritesSortStore((s) => s.sortMode)

  // Reset to page 1 whenever the sort mode changes, mirroring how a query
  // change remounts this component (see the `key` in FavoritesList above).
  const [prevSortMode, setPrevSortMode] = useState(sortMode)
  if (sortMode !== prevSortMode) {
    setPrevSortMode(sortMode)
    setOffset(0)
  }

  const handlePageChange = (newOffset: number) => {
    setOffset(newOffset)
    // Reset the scroll position so a new page starts from the top instead of
    // wherever the previous page was scrolled to.
    getScrollableParent(rootRef.current)?.scrollTo({ top: 0 })
  }

  const filtered = useMemo(() => {
    if (!favorites) return []
    const q = query?.toLowerCase()
    const matched = q
      ? favorites.filter(
          (fav) =>
            fav.song?.title.toLowerCase().includes(q) ||
            fav.song?.artist?.toLowerCase().includes(q),
        )
      : favorites
    return sortFavorites(matched, sortMode)
  }, [favorites, query, sortMode])

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
    <div ref={rootRef}>
      <div className="grid grid-cols-1 gap-3" data-testid="favorites-list">
        {page.map((fav) =>
          fav.song ? <SongCard key={fav.id} song={fav.song} /> : null,
        )}
      </div>
      <Pagination offset={offset} limit={PAGE_SIZE} total={total} onPageChange={handlePageChange} />
    </div>
  )
}

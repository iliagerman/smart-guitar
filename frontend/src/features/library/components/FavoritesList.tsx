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
import { Link } from 'react-router-dom'
import { songDetailPath } from '@/router/routes'
import { displayArtistName, displaySongTitle } from '@/lib/format-song'
import { useHits } from '@/features/songs/hooks/use-hits'
import { Cover } from '@/features/songs/components/tour/HitsSection'

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

  if (!favorites?.length) return <EmptyCrate />

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

/** Nothing saved yet: say how to fill the crate and offer hits to start with. */
function EmptyCrate() {
  const { data } = useHits()
  const picks = data?.items?.slice(0, 8) ?? []
  return (
    <div className="py-6 text-center" data-testid="favorites-empty">
      <div className="mx-auto grid size-16 place-items-center rounded-full bg-fire-500/15 text-fire-400 shadow-[0_0_40px_rgba(249,115,22,0.25)]">
        <Heart size={30} className="animate-heartbeat motion-reduce:animate-none" aria-hidden="true" />
      </div>
      <h2 className="mt-5 font-display text-4xl tracking-wide text-smoke-100">YOUR CRATE IS EMPTY</h2>
      <p className="mx-auto mt-2 max-w-sm text-sm text-smoke-400">
        Tap the heart on any song and it lands here, ready for tonight. Start with one everybody knows:
      </p>
      {picks.length > 0 && (
        <div className="mx-auto mt-8 grid max-w-3xl grid-cols-2 gap-4 text-left sm:grid-cols-4">
          {picks.map((song) => (
            <Link key={song.id} to={songDetailPath(song.id)} className="album-card group block rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-flame-400/70">
              <span className="block aspect-square overflow-hidden rounded-2xl bg-stage-800 shadow-[0_18px_40px_rgba(0,0,0,0.5)] ring-1 ring-white/10">
                <Cover song={song} />
              </span>
              <span className="mt-2 block truncate text-sm font-bold text-smoke-100" dir="auto">{displaySongTitle(song)}</span>
              <span className="block truncate text-xs text-smoke-400" dir="auto">{displayArtistName(song)}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}

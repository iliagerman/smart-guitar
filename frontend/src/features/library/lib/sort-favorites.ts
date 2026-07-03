import type { Favorite } from '@/types/favorite'
import type { FavoritesSortMode } from '@/stores/favorites-sort.store'

function byRecentlyAdded(a: Favorite, b: Favorite): number {
  return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
}

function byMostPlayed(a: Favorite, b: Favorite): number {
  const playCountDiff = (b.song?.play_count ?? 0) - (a.song?.play_count ?? 0)
  return playCountDiff !== 0 ? playCountDiff : byRecentlyAdded(a, b)
}

/** Sorts favorites by the given mode without mutating the input array. */
export function sortFavorites(favorites: Favorite[], mode: FavoritesSortMode): Favorite[] {
  const comparator = mode === 'most_played' ? byMostPlayed : byRecentlyAdded
  return [...favorites].sort(comparator)
}

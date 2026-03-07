import { useQuery } from '@tanstack/react-query'
import { favoritesApi } from '@/api/favorites.api'
import { queryKeys } from '@/api/query-keys'

export function useFavorites() {
  return useQuery({
    queryKey: queryKeys.favorites.list(),
    queryFn: () => favoritesApi.list(),
  })
}

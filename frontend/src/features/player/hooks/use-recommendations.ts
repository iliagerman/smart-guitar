import { useQuery } from '@tanstack/react-query'
import { queryKeys } from '@/api/query-keys'
import { songsApi } from '@/api/songs.api'

/**
 * Fetches song recommendations for a given seed song.
 *
 * @example
 * const { data: recommendations } = useRecommendations(songId)
 */
export function useRecommendations(songId: string, limit = 10) {
  return useQuery({
    queryKey: queryKeys.songs.recommendations(songId),
    queryFn: () => songsApi.recommendations(songId, limit),
    staleTime: 5 * 60 * 1000,
    enabled: !!songId,
  })
}

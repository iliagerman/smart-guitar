import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { songsApi } from '@/api/songs.api'
import { queryKeys } from '@/api/query-keys'

export function useSongs(query?: string, offset = 0, limit = 20) {
  return useQuery({
    queryKey: queryKeys.songs.list(query, offset, limit),
    queryFn: () => songsApi.list({
      query: query || undefined,
      offset,
      limit,
    }),
    placeholderData: keepPreviousData,
  })
}

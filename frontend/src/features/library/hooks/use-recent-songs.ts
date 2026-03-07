import { useQuery } from '@tanstack/react-query'
import { songsApi } from '@/api/songs.api'
import { queryKeys } from '@/api/query-keys'

export function useRecentSongs(limit = 10) {
  return useQuery({
    queryKey: queryKeys.songs.recent(limit),
    queryFn: () => songsApi.recent(limit),
  })
}

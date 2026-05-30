import { useMutation } from '@tanstack/react-query'
import { songsApi } from '@/api/songs.api'

export function useSearchSongs() {
  // Search is a read that mutates nothing on the server; it is modeled as a mutation
  // only so callers can trigger it imperatively. There is nothing to invalidate.
  // oxlint-disable-next-line react-doctor/query-mutation-missing-invalidation
  return useMutation({
    mutationFn: (query: string) => songsApi.search(query),
  })
}

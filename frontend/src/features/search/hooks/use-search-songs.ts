import { useMutation } from '@tanstack/react-query'
import { songsApi } from '@/api/songs.api'

export function useSearchSongs() {
  return useMutation({
    mutationFn: (query: string) => songsApi.search(query),
  })
}

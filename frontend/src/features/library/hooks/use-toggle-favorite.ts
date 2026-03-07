import { useMutation, useQueryClient } from '@tanstack/react-query'
import { favoritesApi } from '@/api/favorites.api'
import { queryKeys } from '@/api/query-keys'

export function useToggleFavorite() {
  const queryClient = useQueryClient()

  const add = useMutation({
    mutationFn: (songId: string) => favoritesApi.add(songId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.favorites.all })
    },
  })

  const remove = useMutation({
    mutationFn: (songId: string) => favoritesApi.remove(songId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.favorites.all })
    },
  })

  return { add, remove }
}

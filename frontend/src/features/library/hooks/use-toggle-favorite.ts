import { useMutation, useQueryClient } from '@tanstack/react-query'
import { favoritesApi } from '@/api/favorites.api'
import { queryKeys } from '@/api/query-keys'
import type { Favorite } from '@/types/favorite'

export function useToggleFavorite() {
  const queryClient = useQueryClient()

  const add = useMutation({
    mutationFn: (songId: string) => favoritesApi.add(songId),
    onMutate: async (songId) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.favorites.list() })
      const previous = queryClient.getQueryData<Favorite[]>(queryKeys.favorites.list())
      queryClient.setQueryData<Favorite[]>(queryKeys.favorites.list(), (old = []) => [
        ...old,
        { id: `temp-${songId}`, user_id: '', song_id: songId, created_at: '', updated_at: '' },
      ])
      return { previous }
    },
    onError: (_err, _songId, context) => {
      if (context?.previous) {
        queryClient.setQueryData(queryKeys.favorites.list(), context.previous)
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.favorites.all })
    },
  })

  const remove = useMutation({
    mutationFn: (songId: string) => favoritesApi.remove(songId),
    onMutate: async (songId) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.favorites.list() })
      const previous = queryClient.getQueryData<Favorite[]>(queryKeys.favorites.list())
      queryClient.setQueryData<Favorite[]>(queryKeys.favorites.list(), (old = []) =>
        old.filter((f) => f.song_id !== songId)
      )
      return { previous }
    },
    onError: (_err, _songId, context) => {
      if (context?.previous) {
        queryClient.setQueryData(queryKeys.favorites.list(), context.previous)
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.favorites.all })
    },
  })

  return { add, remove }
}

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { jobsApi } from '@/api/jobs.api'
import { queryKeys } from '@/api/query-keys'

export function useCreateJob() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ songId, descriptions }: { songId: string; descriptions: string[] }) =>
      jobsApi.create(songId, descriptions),
    onSuccess: (_, { songId }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.songs.detail(songId) })
    },
  })
}

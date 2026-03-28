import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { songsApi } from '@/api/songs.api'
import { queryKeys } from '@/api/query-keys'

interface ChordVoteParams {
  songId: string
  versionKey: string
  vote: number
}

export function useChordVote() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ songId, versionKey, vote }: ChordVoteParams) =>
      songsApi.voteChordVersion(songId, versionKey, vote),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.songs.detail(variables.songId) })
    },
    onError: () => {
      toast.error('Failed to submit vote')
    },
  })
}

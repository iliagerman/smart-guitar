import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { songsApi } from '@/api/songs.api'
import { queryKeys } from '@/api/query-keys'
import { usePlaybackStore } from '@/stores/playback.store'
import { usePlayerPrefsStore } from '@/stores/player-prefs.store'

interface DeleteChordsParams {
  songId: string
}

export function useDeleteChords() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ songId }: DeleteChordsParams) => songsApi.deleteChords(songId),
    onSuccess: (updatedDetail, variables) => {
      queryClient.setQueryData(queryKeys.songs.detail(variables.songId), updatedDetail)
      // Switch back to primary version (index 0)
      usePlayerPrefsStore.getState().setSongOverride(variables.songId, 'selectedVersionIndex', 0)
      usePlaybackStore.getState().setSelectedChordOptionIndex(null)
      toast.success('Chord version deleted')
    },
    onError: (error: unknown) => {
      const apiError = error as { response?: { data?: { detail?: string } } } | undefined
      const msg = apiError?.response?.data?.detail
      toast.error(msg ?? 'Failed to delete chord version')
    },
  })
}

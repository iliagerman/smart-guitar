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
      // Switch back to V2
      usePlayerPrefsStore.getState().setSongOverride(variables.songId, 'chordVersion', 'v2')
      usePlaybackStore.getState().setSelectedChordOptionIndex(null)
      toast.success('Chord version deleted')
    },
    onError: (error: unknown) => {
      const msg = (error as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      toast.error(msg ?? 'Failed to delete chord version')
    },
  })
}

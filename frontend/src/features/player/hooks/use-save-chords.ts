import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { songsApi } from '@/api/songs.api'
import { queryKeys } from '@/api/query-keys'
import { useChordEditStore } from '@/stores/chord-edit.store'
import { usePlaybackStore } from '@/stores/playback.store'
import { usePlayerPrefsStore } from '@/stores/player-prefs.store'
import type { ChordEntry, LyricsSegment } from '@/types/song'

interface SaveChordsParams {
  songId: string
  name: string
  description?: string
  capo?: number
  chords: ChordEntry[]
  lyrics?: LyricsSegment[] | null
}

export function useSaveChords() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ songId, name, description, capo, chords, lyrics }: SaveChordsParams) =>
      songsApi.saveChords(songId, {
        name,
        description: description ?? 'User-edited chords',
        capo: capo ?? 0,
        chords,
        lyrics,
      }),
    onSuccess: (response, variables) => {
      const { detail, saved, duplicate_of } = response

      // Update the query cache with the fresh response from the backend
      queryClient.setQueryData(queryKeys.songs.detail(variables.songId), detail)

      // Exit edit mode
      useChordEditStore.getState().exitEditMode()

      if (!saved && duplicate_of) {
        toast.info(`These chords are identical to "${duplicate_of}" — no new version created`)
        return
      }

      // Auto-select the new user version by finding its index in chord_options
      // chord_options now contains all versions (primary, V1, user versions, variants)
      // User versions have version_key containing 'chords_user'
      const allOptions = detail.chord_options ?? []
      const nonVariantOptions = allOptions.filter(
        (o: { name: string; hidden?: boolean }) =>
          !o.name.includes('Beginner') && !o.name.includes('Capo') && !o.hidden,
      )
      // Find the last user version (the one just saved)
      let lastUserIdx = -1
      for (let i = nonVariantOptions.length - 1; i >= 0; i--) {
        if (nonVariantOptions[i].version_key?.includes('chords_user')) {
          lastUserIdx = i
          break
        }
      }
      if (lastUserIdx >= 0) {
        usePlayerPrefsStore.getState().setSongOverride(
          variables.songId,
          'selectedVersionIndex',
          lastUserIdx,
        )
        usePlaybackStore.getState().setSheetMode('chords')
        usePlaybackStore.getState().setSelectedChordOptionIndex(null)
      }

      toast.success('Chords saved')
    },
    onError: (error: unknown) => {
      const apiError = error as { response?: { data?: { detail?: string } } } | undefined
      const msg = apiError?.response?.data?.detail
      toast.error(msg ?? 'Failed to save chords')
    },
  })
}

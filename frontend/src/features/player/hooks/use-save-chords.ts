import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { songsApi } from '@/api/songs.api'
import { queryKeys } from '@/api/query-keys'
import { useChordEditStore } from '@/stores/chord-edit.store'
import { usePlaybackStore } from '@/stores/playback.store'
import { usePlayerPrefsStore } from '@/stores/player-prefs.store'
import type { ChordVersion } from '@/stores/player-prefs.store'
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

      // Auto-select the new user version via the chord version toggle
      const userOptions = (detail.chord_options ?? []).filter(
        (o) => o.version_key?.includes('chords_user'),
      )
      if (userOptions.length > 0) {
        const versionNum = userOptions.length + 2
        const version: ChordVersion = `v${versionNum}`
        usePlayerPrefsStore.getState().setSongOverride(variables.songId, 'chordVersion', version)
        usePlaybackStore.getState().setSheetMode('chords')
        usePlaybackStore.getState().setSelectedChordOptionIndex(null)
      }

      toast.success('Chords saved')
    },
    onError: (error: unknown) => {
      const msg = (error as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      toast.error(msg ?? 'Failed to save chords')
    },
  })
}

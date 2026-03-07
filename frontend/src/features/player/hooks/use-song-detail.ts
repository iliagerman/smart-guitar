import { useQuery } from '@tanstack/react-query'
import { songsApi } from '@/api/songs.api'
import { queryKeys } from '@/api/query-keys'
import type { SongDetail } from '@/types/song'

/**
 * Lightweight fingerprint of the meaningful content in a SongDetail.
 * Excludes presigned S3 URLs (which rotate on every API response)
 * so we can detect when actual content has changed vs. just URLs.
 */
function contentFingerprint(d: SongDetail): string {
  return [
    d.chords.length,
    d.lyrics.length,
    d.quick_lyrics.length,
    d.tabs.length,
    d.strums.length,
    d.chord_options.length,
    Object.values(d.stems).filter(Boolean).length,
    d.active_job?.id ?? '',
    d.active_job?.status ?? '',
    d.lyrics_source ?? '',
    d.quick_lyrics_source ?? '',
  ].join('|')
}

export function useSongDetail(songId: string, opts?: { pollForTabs?: boolean }) {
  const pollForTabs = opts?.pollForTabs ?? false

  return useQuery({
    queryKey: queryKeys.songs.detail(songId),
    queryFn: () => songsApi.detail(songId),
    enabled: !!songId,
    refetchInterval: (query) => {
      const detail = query.state.data as SongDetail | undefined
      if (!detail) return 6000

      // If there's an active job, keep polling until it finishes.
      if (detail.active_job) return 6000

      const missingAnyStem = detail.stem_types.some((s) => !detail.stems[s.name])
      const missingAccurateLyrics = (detail.lyrics?.length ?? 0) === 0
      const missingQuickLyrics = (detail.quick_lyrics?.length ?? 0) === 0
      // Poll until *both* versions are present. Accurate lyrics may arrive later,
      // even after quick lyrics are already shown.
      const missingTabs = pollForTabs && (detail.tabs?.length ?? 0) === 0

      // Keep polling while data is still missing (background retries may fill it in).
      // But only poll up to a reasonable interval — lyrics/tabs may have failed.
      if (missingAnyStem) return 6000

      // Tabs are interactive UI in 'tabs' mode; keep this snappy.
      if (missingTabs) return 5000

      // Quick lyrics are meant to appear ASAP.
      if (missingQuickLyrics) return 5000

      // Accurate lyrics can take longer; poll less aggressively once quick lyrics exist.
      if (missingAccurateLyrics) return 12000

      return false
    },
    // Each poll returns new presigned S3 URLs even when content (chords, lyrics,
    // etc.) hasn't changed. Default structural sharing can't help because the URL
    // strings differ. Use a content fingerprint to return the old object reference
    // when only URLs rotated — this prevents the entire component tree from
    // re-rendering on every poll cycle.
    structuralSharing: (oldData, newData) => {
      if (!oldData || !newData) return newData ?? oldData
      if (contentFingerprint(oldData as SongDetail) === contentFingerprint(newData as SongDetail)) {
        return oldData
      }
      return newData
    },
  })
}

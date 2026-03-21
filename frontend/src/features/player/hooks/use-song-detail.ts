import { useQuery } from '@tanstack/react-query'
import { songsApi } from '@/api/songs.api'
import { queryKeys } from '@/api/query-keys'
import type { SongDetail } from '@/types/song'

function getVer1Lyrics(detail: SongDetail): SongDetail['lyrics'] {
  return detail.ver1_lyrics ?? detail.quick_lyrics ?? []
}

function getVer2Lyrics(detail: SongDetail): SongDetail['lyrics'] {
  return detail.ver2_lyrics ?? detail.lyrics ?? []
}

function getVer3Lyrics(detail: SongDetail): SongDetail['lyrics'] {
  return detail.ver3_lyrics ?? detail.corrected_lyrics ?? []
}

function getVer1Source(detail: SongDetail): string {
  return detail.ver1_lyrics_source ?? detail.quick_lyrics_source ?? ''
}

function getVer2Source(detail: SongDetail): string {
  return detail.ver2_lyrics_source ?? detail.lyrics_source ?? ''
}

function getVer3Source(detail: SongDetail): string {
  return detail.ver3_lyrics_source ?? detail.corrected_lyrics_source ?? ''
}

/**
 * Lightweight fingerprint of the meaningful content in a SongDetail.
 * Excludes presigned S3 URLs (which rotate on every API response)
 * so we can detect when actual content has changed vs. just URLs.
 */
function contentFingerprint(d: SongDetail): string {
  return [
    d.chords.length,
    getVer1Lyrics(d).length,
    getVer2Lyrics(d).length,
    getVer3Lyrics(d).length,
    d.tabs.length,
    d.strums.length,
    d.chord_options.length,
    Object.values(d.stems).filter(Boolean).length,
    d.active_job?.id ?? '',
    d.active_job?.status ?? '',
    d.download_pending,
    getVer1Source(d),
    getVer2Source(d),
    getVer3Source(d),
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

      // Audio is being downloaded — keep polling until it completes.
      if (detail.download_pending) return 6000

      // If there's an active job, keep polling until it finishes.
      if (detail.active_job) return 6000

      const missingAnyStem = detail.stem_types.some((s) => !detail.stems[s.name])
      const ver1Lyrics = getVer1Lyrics(detail)
      const ver2Lyrics = getVer2Lyrics(detail)
      const ver3Lyrics = getVer3Lyrics(detail)
      const missingVer1Lyrics = ver1Lyrics.length === 0
      const missingVer2Lyrics = ver2Lyrics.length === 0
      const missingVer3Lyrics =
        ver1Lyrics.length > 0 && ver2Lyrics.length > 0 && ver3Lyrics.length === 0
      const missingTabs = pollForTabs && (detail.tabs?.length ?? 0) === 0

      // Keep polling while data is still missing (background retries may fill it in).
      // But only poll up to a reasonable interval — lyrics/tabs may have failed.
      if (missingAnyStem) return 6000

      // Tabs are interactive UI in 'tabs' mode; keep this snappy.
      if (missingTabs) return 5000

      // Ver 1 lyrics are meant to appear ASAP.
      if (missingVer1Lyrics) return 5000

      // Ver 2 can take longer; poll less aggressively once ver1 exists.
      if (missingVer2Lyrics) return 12000

      // When ver1 + ver2 exist, keep polling for the auto-generated merged ver3.
      if (missingVer3Lyrics) return 8000

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

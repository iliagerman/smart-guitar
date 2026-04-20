import type { ChordOption, LyricsSegment, SongDetail } from '@/types/song'
import type { LyricsSourceMode } from '@/stores/player-prefs.store'

export interface LyricsSourceOption {
  key: LyricsSourceMode
  label: string
  description: string
  segments: LyricsSegment[]
  source: string | null
}

function getVer1Lyrics(detail: SongDetail): LyricsSegment[] {
  return detail.ver1_lyrics ?? detail.quick_lyrics ?? []
}

function getVer2Lyrics(detail: SongDetail): LyricsSegment[] {
  return detail.ver2_lyrics ?? detail.lyrics ?? []
}

function getVer3Lyrics(detail: SongDetail): LyricsSegment[] {
  return detail.ver3_lyrics ?? detail.corrected_lyrics ?? []
}

function getVer1Source(detail: SongDetail): string | null {
  return detail.ver1_lyrics_source ?? detail.quick_lyrics_source ?? null
}

function getVer2Source(detail: SongDetail): string | null {
  return detail.ver2_lyrics_source ?? detail.lyrics_source ?? null
}

function getVer3Source(detail: SongDetail): string | null {
  return detail.ver3_lyrics_source ?? detail.corrected_lyrics_source ?? null
}

function usesCustomLyrics(activeVersion: ChordOption | undefined): boolean {
  return !!activeVersion?.version_key?.includes('chords_user') && (activeVersion?.lyrics?.length ?? 0) > 0
}

function isLikelyNonLatin(detail: SongDetail): boolean {
  const sample = [
    ...getVer3Lyrics(detail),
    ...getVer1Lyrics(detail),
    ...getVer2Lyrics(detail),
  ]
    .map((segment) => segment.text)
    .join(' ')
    .slice(0, 600)

  const letters = Array.from(sample).filter((char) => /\p{Letter}/u.test(char))
  if (letters.length === 0) {
    return false
  }
  const latinLetters = letters.filter((char) => /\p{Script=Latin}/u.test(char)).length
  return latinLetters / letters.length < 0.6
}

function getAutoLyrics(detail: SongDetail, activeVersion: ChordOption | undefined): LyricsSourceOption | null {
  if (usesCustomLyrics(activeVersion)) {
    return {
      key: 'auto',
      label: 'Auto',
      description: 'Following your custom lyrics',
      segments: activeVersion?.lyrics ?? [],
      source: activeVersion?.lyrics_source ?? null,
    }
  }

  const mergedLyrics = getVer3Lyrics(detail)
  if (mergedLyrics.length > 0) {
    return {
      key: 'auto',
      label: 'Auto',
      description: 'Recommended: merged text + timing',
      segments: mergedLyrics,
      source: getVer3Source(detail),
    }
  }

  const onlineLyrics = getVer1Lyrics(detail)
  const timedLyrics = getVer2Lyrics(detail)
  const altLyrics = detail.ver4_lyrics ?? []
  const likelyNonLatin = isLikelyNonLatin(detail)

  if (likelyNonLatin && onlineLyrics.length > 0) {
    return {
      key: 'auto',
      label: 'Auto',
      description: 'Recommended: online lyrics for this language',
      segments: onlineLyrics,
      source: getVer1Source(detail),
    }
  }
  if (timedLyrics.length > 0) {
    return {
      key: 'auto',
      label: 'Auto',
      description: 'Recommended: strongest word timing',
      segments: timedLyrics,
      source: getVer2Source(detail),
    }
  }
  if (onlineLyrics.length > 0) {
    return {
      key: 'auto',
      label: 'Auto',
      description: 'Recommended: fetched online lyrics',
      segments: onlineLyrics,
      source: getVer1Source(detail),
    }
  }
  if (altLyrics.length > 0) {
    return {
      key: 'auto',
      label: 'Auto',
      description: 'Recommended: alternative lyrics source',
      segments: altLyrics,
      source: detail.ver4_lyrics_source ?? null,
    }
  }

  return null
}

/** Builds the independently switchable lyrics sources shown in the player UI. */
export function getAvailableLyricsSources(
  detail: SongDetail,
  activeVersion: ChordOption | undefined,
): LyricsSourceOption[] {
  const options: LyricsSourceOption[] = []
  const autoOption = getAutoLyrics(detail, activeVersion)

  if (autoOption) {
    options.push(autoOption)
  }
  if (getVer1Lyrics(detail).length > 0) {
    options.push({
      key: 'ver1',
      label: 'Online',
      description: 'Fetched lyrics with fast alignment',
      segments: getVer1Lyrics(detail),
      source: getVer1Source(detail),
    })
  }
  if (getVer2Lyrics(detail).length > 0) {
    options.push({
      key: 'ver2',
      label: 'AI Timed',
      description: 'Generated from audio with word timing',
      segments: getVer2Lyrics(detail),
      source: getVer2Source(detail),
    })
  }
  if (getVer3Lyrics(detail).length > 0) {
    options.push({
      key: 'ver3',
      label: 'Merged',
      description: 'Online text merged with AI timing',
      segments: getVer3Lyrics(detail),
      source: getVer3Source(detail),
    })
  }
  if ((detail.ver4_lyrics ?? []).length > 0) {
    options.push({
      key: 'ver4',
      label: 'Alt',
      description: 'Alternative lyrics source',
      segments: detail.ver4_lyrics ?? [],
      source: detail.ver4_lyrics_source ?? null,
    })
  }

  options.push({
    key: 'off',
    label: 'Off',
    description: 'Hide lyrics highlighting',
    segments: [],
    source: null,
  })
  return options
}

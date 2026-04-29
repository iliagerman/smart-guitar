import type { ChordOption } from '@/types/song'
import type { LyricsHighlightMode } from '@/stores/player-prefs.store'

const USER_VERSION_KEY = 'chords_user'

function getOptionDescription(option: ChordOption): string {
  return option.description ?? ''
}

function isCommunityOption(option: ChordOption): boolean {
  return getOptionDescription(option).startsWith('Community chord sheet')
    || option.lyrics_source === 'community'
}

function isDetectedOption(option: ChordOption): boolean {
  return getOptionDescription(option) === 'Auto-detected chords'
}

function isUserOption(option: ChordOption): boolean {
  return option.version_key?.includes(USER_VERSION_KEY) === true
}

/**
 * Collapses backend chord options into distinct sheet sources for the player UI.
 * Detected chords come first so they are the default selection; community
 * sheets follow, then user-created versions.
 */
export function buildSheetVersions(options: ChordOption[]): ChordOption[] {
  const visible = options.filter((option) => !option.hidden && !option.is_variant)
  const result: ChordOption[] = []
  const picked = new Set<ChordOption>()

  // Detected chords (autochord) first — default sheet for every song.
  const detectedOptions = visible.filter(isDetectedOption)
  const detectedOption = detectedOptions[detectedOptions.length - 1]
  if (detectedOption) {
    picked.add(detectedOption)
    result.push(detectedOption)
  }

  // Community options (Sheet 1, Sheet 2, Sheet 3)
  for (const option of visible.filter(isCommunityOption)) {
    picked.add(option)
    result.push(option)
  }

  // User-created versions
  for (const option of visible.filter(isUserOption)) {
    picked.add(option)
    result.push(option)
  }

  // Any remaining options not yet picked
  for (const option of visible) {
    if (!picked.has(option)) {
      result.push(option)
    }
  }

  return result
}

/** Returns a stable preference key for a sheet source selection. */
export function getSheetVersionPreferenceKey(
  option: ChordOption | undefined,
  index: number,
): string {
  if (!option) {
    return `sheet:${index}`
  }
  if (isDetectedOption(option)) {
    return 'detected'
  }
  if (option.version_key) {
    return option.version_key
  }
  if (isCommunityOption(option)) {
    return `community:${option.name}:${option.description}:${option.capo}`
  }
  return `sheet:${option.name}:${option.description}:${option.capo}:${index}`
}

/** Returns a compact, user-facing label for a sheet source. */
export function getSheetVersionLabel(
  option: ChordOption | undefined,
  index: number,
): string {
  if (!option) {
    return `Sheet ${index + 1}`
  }
  if (isUserOption(option)) {
    const name = option.name.trim()
    return name.length > 0 ? name : 'Custom'
  }
  if (isDetectedOption(option)) {
    return 'Detected'
  }
  // Community or other — use the name from backend (e.g. "Sheet 1", "Sheet 2")
  const name = option.name.trim()
  return name.length > 0 ? name : `Sheet ${index + 1}`
}

/**
 * Lyrics-tracking mode that should be active for a given sheet selection.
 *
 * Community/UG sheets only have estimated word timing, so per-word
 * highlighting looks broken — auto-scroll ('none') is the right default.
 * Detected and user-edited sheets have real timing and should highlight.
 */
export function lyricsModeForActiveVersion(
  option: ChordOption | undefined,
): LyricsHighlightMode {
  if (option && isCommunityOption(option)) {
    return 'none'
  }
  return 'highlight'
}

/** Short helper text shown in the sheet source picker. */
export function getSheetVersionDescription(option: ChordOption | undefined): string {
  if (!option) {
    return 'Choose a sheet source'
  }
  if (isUserOption(option)) {
    return 'Your saved chord edit'
  }
  if (isDetectedOption(option)) {
    return 'Audio-detected chord timeline'
  }
  if (isCommunityOption(option)) {
    return 'Community chord sheet'
  }
  return option.description || 'Choose a sheet source'
}

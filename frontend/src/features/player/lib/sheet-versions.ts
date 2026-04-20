import type { ChordOption } from '@/types/song'

const USER_VERSION_KEY = 'chords_user'

function isCommunityOption(option: ChordOption): boolean {
  return option.description.startsWith('Community chord sheet')
}

function isDetectedOption(option: ChordOption): boolean {
  return option.description === 'Auto-detected chords'
}

function isUserOption(option: ChordOption): boolean {
  return option.version_key?.includes(USER_VERSION_KEY) === true
}

/**
 * Collapses backend chord options into distinct sheet sources for the player UI.
 * Community versions (from external sources) come first, then detected, then user.
 */
export function buildSheetVersions(
  options: ChordOption[],
  _preferredSource: string | null = null,
): ChordOption[] {
  const visible = options.filter((option) => !option.hidden && !option.is_variant)
  const result: ChordOption[] = []
  const picked = new Set<ChordOption>()

  // Community options first (Sheet 1, Sheet 2, Sheet 3)
  for (const option of visible.filter(isCommunityOption)) {
    picked.add(option)
    result.push(option)
  }

  // Detected chords (autochord) as fallback
  const detectedOptions = visible.filter(isDetectedOption)
  const detectedOption = detectedOptions[detectedOptions.length - 1]
  if (detectedOption) {
    picked.add(detectedOption)
    result.push(detectedOption)
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

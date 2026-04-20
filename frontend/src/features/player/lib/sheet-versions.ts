import type { ChordOption } from '@/types/song'

const USER_VERSION_KEY = 'chords_user'

function isAutoOption(option: ChordOption): boolean {
  return option.description === 'Auto-detected chords'
}

function isAiOption(option: ChordOption): boolean {
  return option.description === 'Gemini-detected chords'
}

function isHybridOption(option: ChordOption): boolean {
  return option.description === 'Hybrid chords'
}

function isUserOption(option: ChordOption): boolean {
  return option.version_key?.includes(USER_VERSION_KEY) === true
}

/**
 * Collapses backend chord options into distinct sheet sources for the mobile UI.
 * Auto-detected options differ only by paired lyrics, so we keep the best one.
 */
export function buildSheetVersions(
  options: ChordOption[],
  preferredSource: 'gemini' | 'autochord' | 'hybrid' | null = null,
): ChordOption[] {
  const visible = options.filter((option) => !option.hidden && !option.is_variant)
  const picked = new Set<ChordOption>()
  const result: ChordOption[] = []

  const autoOptions = visible.filter(isAutoOption)
  const autoOption = autoOptions[autoOptions.length - 1]
  const hybridOptions = visible.filter(isHybridOption)
  const hybridOption = hybridOptions[hybridOptions.length - 1]
  const aiOptions = visible.filter(isAiOption)
  const aiOption = aiOptions[aiOptions.length - 1]
  const preferredSystemOptions = preferredSource === 'gemini'
    ? [aiOption, hybridOption, autoOption]
    : preferredSource === 'hybrid'
      ? [hybridOption, autoOption, aiOption]
      : [autoOption, hybridOption, aiOption]

  for (const option of preferredSystemOptions) {
    if (!option) {
      continue
    }
    picked.add(option)
    result.push(option)
  }

  for (const option of visible.filter(isUserOption)) {
    picked.add(option)
    result.push(option)
  }

  for (const option of visible) {
    if (picked.has(option)) {
      continue
    }
    if (isAutoOption(option) || isAiOption(option) || isHybridOption(option) || isUserOption(option)) {
      continue
    }
    result.push(option)
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
  if (isAiOption(option)) {
    return 'AI'
  }
  if (isHybridOption(option)) {
    return 'Hybrid'
  }
  if (isAutoOption(option)) {
    return 'Detected'
  }
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
  if (isAiOption(option)) {
    return 'AI-detected chord names'
  }
  if (isHybridOption(option)) {
    return 'AI chord names on detected timing'
  }
  if (isAutoOption(option)) {
    return 'Classic detected chord timeline'
  }
  return option.description || 'Choose a sheet source'
}

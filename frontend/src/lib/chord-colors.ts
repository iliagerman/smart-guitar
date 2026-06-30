import { formatChordDisplayName, getChordRootNote } from '@/lib/chord-utils'

const chordColorMapLight: Record<string, string> = {
  'C': 'text-emerald-700',
  'C#': 'text-emerald-700',
  'Db': 'text-emerald-700',
  'D': 'text-emerald-700',
  'D#': 'text-emerald-700',
  'Eb': 'text-emerald-700',
  'E': 'text-emerald-700',
  'F': 'text-emerald-700',
  'F#': 'text-emerald-700',
  'Gb': 'text-emerald-700',
  'G': 'text-emerald-700',
  'G#': 'text-emerald-700',
  'Ab': 'text-emerald-700',
  'A': 'text-emerald-700',
  'A#': 'text-emerald-700',
  'Bb': 'text-emerald-700',
  'B': 'text-emerald-700',
  'N': 'text-charcoal-500',
}

const chordColorMapDark: Record<string, string> = {
  'C': 'text-[#55c878]',
  'C#': 'text-[#55c878]',
  'Db': 'text-[#55c878]',
  'D': 'text-[#55c878]',
  'D#': 'text-[#55c878]',
  'Eb': 'text-[#55c878]',
  'E': 'text-[#55c878]',
  'F': 'text-[#55c878]',
  'F#': 'text-[#55c878]',
  'Gb': 'text-[#55c878]',
  'G': 'text-[#55c878]',
  'G#': 'text-[#55c878]',
  'Ab': 'text-[#55c878]',
  'A': 'text-[#55c878]',
  'A#': 'text-[#55c878]',
  'Bb': 'text-[#55c878]',
  'B': 'text-[#55c878]',
  'N': 'text-smoke-500',
}

export function getChordColor(chord: string, variant: 'light' | 'dark' = 'light'): string {
  const root = getChordRootNote(chord, { preferSharps: true })
  const map = variant === 'light' ? chordColorMapLight : chordColorMapDark
  return map[root] || (variant === 'light' ? 'text-emerald-700' : 'text-[#55c878]')
}

/**
 * Convert backend chord notation (e.g. "B:min", "Gb:maj", "A:7")
 * to display-friendly names (e.g. "Bm", "Gb", "A7").
 */
export function formatChordName(chord: string): string {
  return formatChordDisplayName(chord, { preferSharps: true })
}

/**
 * Format a chord for display, optionally appending its slash bass note.
 * Returns the plain chord name when the bass toggle is off or no bass note
 * was detected (root position). E.g. ("C:maj", "G", true) -> "C/G".
 */
export function formatChordWithBass(
  chord: string,
  bass: string | null | undefined,
  showBass: boolean,
): string {
  const name = formatChordName(chord)
  if (!showBass || !bass) return name
  return `${name}/${bass}`
}

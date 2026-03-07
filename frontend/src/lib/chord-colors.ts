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
  'C': 'text-emerald-400',
  'C#': 'text-emerald-400',
  'Db': 'text-emerald-400',
  'D': 'text-emerald-400',
  'D#': 'text-emerald-400',
  'Eb': 'text-emerald-400',
  'E': 'text-emerald-400',
  'F': 'text-emerald-400',
  'F#': 'text-emerald-400',
  'Gb': 'text-emerald-400',
  'G': 'text-emerald-400',
  'G#': 'text-emerald-400',
  'Ab': 'text-emerald-400',
  'A': 'text-emerald-400',
  'A#': 'text-emerald-400',
  'Bb': 'text-emerald-400',
  'B': 'text-emerald-400',
  'N': 'text-smoke-500',
}

export function getChordColor(chord: string, variant: 'light' | 'dark' = 'light'): string {
  const root = getChordRootNote(chord, { preferSharps: true })
  const map = variant === 'light' ? chordColorMapLight : chordColorMapDark
  return map[root] || (variant === 'light' ? 'text-emerald-700' : 'text-emerald-400')
}

/**
 * Convert backend chord notation (e.g. "B:min", "Gb:maj", "A:7")
 * to display-friendly names (e.g. "Bm", "Gb", "A7").
 */
export function formatChordName(chord: string): string {
  return formatChordDisplayName(chord, { preferSharps: true })
}

import type { ChordEntry } from '@/types/song'
import { transposeChordLabel, normalizeNoteToSharps, formatChordDisplayName } from './chord-utils'

const OPEN_CHORDS = new Set(['C', 'D', 'E', 'G', 'A', 'Am', 'Dm', 'Em'])

const OPEN_MAJOR_MAP: Record<string, string> = {
  C: 'C', 'C#': 'D', D: 'D', 'D#': 'E', E: 'E',
  F: 'E', 'F#': 'G', G: 'G', 'G#': 'A', A: 'A',
  'A#': 'A', B: 'C',
}

const OPEN_MINOR_MAP: Record<string, string> = {
  C: 'Am', 'C#': 'Am', D: 'Dm', 'D#': 'Em', E: 'Em',
  F: 'Em', 'F#': 'Em', G: 'Am', 'G#': 'Am', A: 'Am',
  'A#': 'Am', B: 'Am',
}

/**
 * Strip chord extensions (7, 9, sus, etc.) to basic major or minor.
 * "Cmaj7" -> "C", "Dm7" -> "Dm", "Gsus4" -> "G", "Bdim" -> "Bm"
 */
export function simplifyToTriad(chord: string): string {
  const formatted = formatChordDisplayName(chord, { preferSharps: true })
  if (!formatted || formatted === 'N') return formatted

  const m = /^([A-G][#b]?)(.*)$/.exec(formatted)
  if (!m) return formatted
  const root = normalizeNoteToSharps(m[1])
  const suffix = m[2] ?? ''

  const isMinor = /^m($|[^a])/i.test(suffix) || /dim/i.test(suffix)
  return isMinor ? `${root}m` : root
}

/**
 * Map any chord to the nearest beginner-friendly open chord.
 */
export function toOpenChord(chord: string): string {
  const triad = simplifyToTriad(chord)
  if (!triad || triad === 'N') return triad

  const m = /^([A-G][#b]?)(m?)$/.exec(triad)
  if (!m) return triad
  const root = normalizeNoteToSharps(m[1])
  const isMinor = m[2] === 'm'

  const map = isMinor ? OPEN_MINOR_MAP : OPEN_MAJOR_MAP
  return map[root] ?? triad
}

/**
 * Count how many of the given chord names are in the open chord set.
 */
export function scoreOpenChords(chords: string[]): number {
  return chords.filter((c) => OPEN_CHORDS.has(simplifyToTriad(c))).length
}

/**
 * Find the best capo fret positions that maximize open chords.
 * Returns up to 2 frets sorted by score desc. Always includes at least
 * the best capo option if it produces a reasonable open chord ratio,
 * even if it doesn't beat the no-capo score.
 */
export function findBestCapoFrets(
  chords: ChordEntry[],
  maxCapo = 7,
): { fret: number; score: number }[] {
  const chordNames = chords.map((c) => c.chord)
  if (chordNames.length === 0) return []

  const baseScore = scoreOpenChords(chordNames)

  const scores: { fret: number; score: number }[] = []
  for (let fret = 1; fret <= maxCapo; fret++) {
    const transposed = chordNames.map((c) => transposeChordLabel(c, -fret))
    const score = scoreOpenChords(transposed)
    scores.push({ fret, score })
  }

  scores.sort((a, b) => b.score - a.score)

  // Keep frets that either beat the base score or cover at least 40% open chords
  const minThreshold = Math.floor(chordNames.length * 0.4)
  const filtered = scores.filter((s) => s.score > baseScore || s.score >= minThreshold)
  return filtered.slice(0, 2)
}

/**
 * Transpose all chords DOWN by capoFret semitones.
 * This gives the chord shapes the player actually fingers with the capo.
 */
export function transposeForCapo(chords: ChordEntry[], capoFret: number): ChordEntry[] {
  return chords.map((c) => ({
    ...c,
    chord: transposeChordLabel(c.chord, -capoFret),
  }))
}

/**
 * Apply beginner simplification to all chords (map to open chords).
 */
export function simplifyChords(chords: ChordEntry[]): ChordEntry[] {
  return chords.map((c) => ({
    ...c,
    chord: toOpenChord(c.chord),
  }))
}

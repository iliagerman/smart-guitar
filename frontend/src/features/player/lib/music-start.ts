import type { ChordEntry } from '@/types/song'

/** Chord labels the detector uses for "no chord" (silence, talking, noise). */
const NO_CHORD = new Set(['N', 'X', ''])
/** A shorter quiet start is part of the song; only skip real dead air. */
const MIN_SKIP_SECONDS = 4
/** Land a moment early so the first chord doesn't start mid-strum. */
const PRE_ROLL_SECONDS = 1

/**
 * Where the music starts: just before the first real chord, when a song's
 * upload opens with a long silent or spoken intro (music videos often do).
 * 0 when the song starts right away.
 */
export function musicStartTime(chords: readonly ChordEntry[]): number {
  const first = chords.find((c) => !NO_CHORD.has(c.chord.trim()))
  if (!first || first.start_time < MIN_SKIP_SECONDS) return 0
  return Math.max(0, first.start_time - PRE_ROLL_SECONDS)
}

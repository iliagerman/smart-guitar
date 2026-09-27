/** How hard the metronome marks a beat. */
export type BeatEmphasis = 'downbeat' | 'accent' | 'normal'

// A beat the snare hits in at least this share of the song's drum bars is accented.
const ACCENT_FROM = 0.5

/**
 * Emphasis for each beat of the bar. Beat 1 is always the downbeat; the song's
 * snare beats (share of drum bars hitting each beat) add accents when they
 * match the meter.
 */
export function beatEmphases(beatsPerBar: number, songAccents: readonly number[] | null): BeatEmphasis[] {
  const matches = songAccents?.length === beatsPerBar
  return Array.from({ length: beatsPerBar }, (_, index) => {
    if (index === 0) return 'downbeat'
    return matches && songAccents[index] >= ACCENT_FROM ? 'accent' : 'normal'
  })
}

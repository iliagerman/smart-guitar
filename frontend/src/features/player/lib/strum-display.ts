import { beatIndexAt } from '@/features/metronome/lib/song-beat-grid'
import type { SongSection } from '@/types/song'
import { directionToSymbol, type SectionStrumPattern } from './strum-pattern'

/** How long to show "looking for the pattern" before settling on the starter. */
export const STRUM_SEARCH_MS = 8000

/** Steps per beat for a pattern whose subdivision is unknown, guessed from its length. */
export function guessStepsPerBeat(patternLength: number): number {
  if (patternLength <= 4) return 1
  if (patternLength <= 8) return 2
  return 4
}

/** Count labels ("1 & 2 &" or "1 e & a") for each step of a pattern. */
export function beatLabels(patternLength: number, stepsPerBeat: number): string[] {
  const between = stepsPerBeat === 4 ? ['', 'e', '&', 'a'] : ['', '&']
  return Array.from({ length: patternLength }, (_, i) =>
    i % stepsPerBeat === 0 ? String(Math.floor(i / stepsPerBeat) + 1) : between[i % stepsPerBeat],
  )
}

const D = directionToSymbol('down')
const U = directionToSymbol('up')
const X = directionToSymbol('miss')

/**
 * For songs whose tab has no strumming: the pattern most songs in the meter can
 * be strummed with (4/4: down, down-up, up-down-up). Shown as a starter, never
 * as the song's own pattern.
 */
export function starterPattern(beatsPerBar: number): SectionStrumPattern {
  if (beatsPerBar === 3) return { name: 'Starter pattern', pattern: [D, X, D, U, D, U], stepsPerBeat: 2 }
  if (beatsPerBar === 6) return { name: 'Starter pattern', pattern: [D, X, U, D, X, U], stepsPerBeat: 1 }
  return { name: 'Starter pattern', pattern: [D, X, D, U, X, U, D, U], stepsPerBeat: 2 }
}

/** The pattern played in most of the song: the section pattern covering the most bars. */
export function mainPattern(sectionPatterns: readonly SectionStrumPattern[]): SectionStrumPattern | null {
  let best: SectionStrumPattern | null = null
  for (const section of sectionPatterns) {
    if (!best || (section.barShare ?? 0) > (best.barShare ?? 0)) best = section
  }
  return best
}

/** "[A] Verse 2: drums enter" -> "Verse": a section name as the tab names its patterns. */
export function sectionLabel(name: string): string {
  const bare = name.replace(/^\[[^\]]*\]\s*/, '').split(/[:(]/)[0]
  return bare.replace(/\s*\d+$/, '').trim()
}

/** The tab pattern for a section; tab patterns are named after the sections they cover ("Intro / Chorus"). */
export function patternForSection(
  sectionPatterns: readonly SectionStrumPattern[],
  sectionName: string,
): SectionStrumPattern | null {
  const key = sectionLabel(sectionName).toLowerCase()
  if (!key) return null
  return sectionPatterns.find((pattern) => pattern.name.split(' / ').some((part) => sectionLabel(part).toLowerCase() === key)) ?? null
}

/** Index of the section playing at `time`, or -1 between or outside sections. */
export function sectionIndexAt(sections: readonly Pick<SongSection, 'start_time' | 'end_time'>[], time: number): number {
  return sections.findIndex((section) => time >= section.start_time && time < section.end_time)
}

/**
 * The pattern step sounding at `time`, counted on the song's beats (the first
 * is a downbeat, so the pattern starts on it). -1 outside the beats or when the
 * pattern doesn't span a whole number of beats.
 */
export function strumStepAt(
  beatTimes: readonly number[],
  time: number,
  patternLength: number,
  stepsPerBeat: number,
): number {
  const beatsInPattern = patternLength / stepsPerBeat
  if (!Number.isInteger(beatsInPattern) || beatsInPattern < 1) return -1
  const beat = beatIndexAt(beatTimes, time)
  if (beat === null) return -1
  const into = (time - beatTimes[beat]) / (beatTimes[beat + 1] - beatTimes[beat])
  const step = Math.min(stepsPerBeat - 1, Math.floor(into * stepsPerBeat))
  return (beat % beatsInPattern) * stepsPerBeat + step
}

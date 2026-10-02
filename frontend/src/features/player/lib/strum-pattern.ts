import type { ChordEntry, RhythmInfo, StrumAccents, StrumEvent, TabRhythm } from '@/types/song'

export function directionToSymbol(direction: StrumDirection): StrumSymbol {
  if (direction === 'miss') {
    return {
      symbol: '·',
      className: 'text-smoke-600',
      title: 'miss (skip)',
      direction,
    }
  }
  if (direction === 'chuck') {
    return {
      symbol: '↓×',
      className: 'text-rose-300',
      title: 'chuck (muted downstroke)',
      direction,
    }
  }
  return {
    symbol: direction === 'down' ? '↓' : '↑',
    className: direction === 'down' ? 'text-emerald-400' : 'text-amber-300',
    title: `${direction} strum`,
    direction,
  }
}
import { buildGridSlots, chooseSubdivision, quantizeStrumsToSlots, type GridSlot, type QuantizedStrum } from './strum-grid'

export type StrumDirection = 'down' | 'up' | 'miss' | 'chuck'

export interface StrumSymbol {
  symbol: string
  className: string
  title: string
  direction: StrumDirection
}

export interface StrumGridCell {
  countLabel: string | null
  symbol: string | null
  className: string
  title: string | null
  direction: 'down' | 'up' | null
}

type DirectionalStrum = StrumEvent & {
  direction: 'down' | 'up'
}

function getDirectionSymbol(direction: 'down' | 'up') {
  return direction === 'down' ? '↓' : '↑'
}

function getDirectionClassName(direction: 'down' | 'up') {
  return direction === 'down' ? 'text-emerald-400' : 'text-amber-300'
}

function getDirectionTitle(direction: 'down' | 'up', confidence: number) {
  return `${direction} strum (${Math.round(confidence * 100)}%)`
}

function isDirectionalStrum(strum: StrumEvent): strum is DirectionalStrum {
  return strum.direction !== 'ambiguous'
}

function getRenderableStrums(strums: StrumEvent[]) {
  return strums.filter(isDirectionalStrum)
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function getSuggestedStrums(start: number, end: number, strums: StrumEvent[]): DirectionalStrum[] {
  // No suggested strums — all external strums are real
  return []
}

export function getStrumGridDisplay(
  start: number,
  end: number,
  strums: StrumEvent[],
  opts?: {
    rhythm?: RhythmInfo | null
  }
) {
  const rhythm = opts?.rhythm ?? null
  if (!rhythm || !Array.isArray(rhythm.beat_times) || rhythm.beat_times.length < 2) {
    return { slots: [] as GridSlot[], quantized: new Map<number, QuantizedStrum>(), isSuggested: false as const }
  }

  const renderableStrums = getRenderableStrums(strums).filter(
    (strum) => strum.start_time >= start - 0.05 && strum.start_time < end
  )

  if (renderableStrums.length > 0) {
    const subdivision = chooseSubdivision('auto', start, end, rhythm, renderableStrums)
    const slots = buildGridSlots(start, end, rhythm, subdivision)
    if (slots.length > 0) {
      const quantized = quantizeStrumsToSlots(slots, renderableStrums)
      if (quantized.size > 0) {
        return { slots, quantized, isSuggested: false as const }
      }
    }
  }

  return { slots: [] as GridSlot[], quantized: new Map<number, QuantizedStrum>(), isSuggested: false as const }
}

function getStrumGridPattern(
  start: number,
  end: number,
  strums: StrumEvent[],
  opts?: {
    rhythm?: RhythmInfo | null
  }
): StrumGridCell[] {
  const { slots, quantized } = getStrumGridDisplay(start, end, strums, opts)
  if (slots.length === 0 || quantized.size === 0) {
    return []
  }

  return slots.map((slot, index) => {
    const qs = quantized.get(index)
    if (!qs) {
      return {
        countLabel: slot.label,
        symbol: null,
        className: 'text-smoke-600',
        title: null,
        direction: null,
      }
    }

    return {
      countLabel: slot.label,
      symbol: getDirectionSymbol(qs.direction),
      className: getDirectionClassName(qs.direction),
      title: getDirectionTitle(qs.direction, qs.confidence),
      direction: qs.direction,
    }
  })
}

/**
 * Find all strum events that fall within a time range.
 * Ambiguous strums are excluded.
 */
export function getStrumPattern(
  start: number,
  end: number,
  strums: StrumEvent[],
  opts?: {
    rhythm?: RhythmInfo | null
  }
): StrumSymbol[] {
  const rhythm = opts?.rhythm ?? null
  const renderableStrums = getRenderableStrums(strums)

  if (rhythm && Array.isArray(rhythm.beat_times) && rhythm.beat_times.length >= 2) {
    const gridPattern = getStrumGridPattern(start, end, renderableStrums, { rhythm })
      .filter((cell) => cell.direction !== null && cell.symbol !== null)
      .map((cell) => ({
        symbol: cell.symbol!,
        className: cell.className,
        title: cell.title ?? '',
        direction: cell.direction!,
      }))

    if (gridPattern.length > 0) {
      return gridPattern
    }
  }

  const pattern: StrumSymbol[] = []
  for (const s of renderableStrums) {
    if (s.start_time >= start - 0.05 && s.start_time < end) {
      pattern.push({
        symbol: getDirectionSymbol(s.direction),
        className: getDirectionClassName(s.direction),
        title: getDirectionTitle(s.direction, s.confidence),
        direction: s.direction,
      })
    }
  }
  return pattern
}

export function getRepresentativeSongStrumPattern(
  chords: ChordEntry[],
  strums: StrumEvent[],
  opts?: {
    rhythm?: RhythmInfo | null
    maxSymbols?: number
  }
): StrumSymbol[] {
  const rhythm = opts?.rhythm ?? null
  const maxSymbols = Math.max(1, opts?.maxSymbols ?? 8)

  const buckets = new Map<string, { pattern: StrumSymbol[]; count: number }>()
  for (const chord of chords) {
    if (chord.chord === 'N') continue
    const pattern = getStrumPattern(chord.start_time, chord.end_time, strums, { rhythm }).slice(0, maxSymbols)
    if (pattern.length === 0) continue
    const key = pattern.map((item) => item.direction[0]).join('')
    const existing = buckets.get(key)
    if (existing) {
      existing.count += 1
      if (pattern.length > existing.pattern.length) {
        existing.pattern = pattern
      }
    } else {
      buckets.set(key, { pattern, count: 1 })
    }
  }

  let best: { pattern: StrumSymbol[]; count: number } | undefined
  for (const cur of buckets.values()) {
    if (
      !best ||
      cur.count > best.count ||
      (cur.count === best.count && cur.pattern.length > best.pattern.length)
    ) {
      best = cur
    }
  }
  if (best) {
    return best.pattern.slice(0, maxSymbols)
  }

  return getRenderableStrums(strums)
    .slice(0, maxSymbols)
    .map((s) => ({
      symbol: getDirectionSymbol(s.direction),
      className: getDirectionClassName(s.direction),
      title: getDirectionTitle(s.direction, s.confidence),
      direction: s.direction,
    }))
}

export interface SectionStrumPattern {
  name: string
  pattern: StrumSymbol[]
  /** Steps per beat when known (tab patterns); otherwise guessed from the length. */
  stepsPerBeat?: number
  /** Strokes to hit harder: measured on the recording, or the tab's snare beats. */
  accents?: boolean[]
  accentSource?: 'recording' | 'snare'

  /** Share of the section's strummed bars played exactly like this (0..1). */
  barShare?: number
}

/**
 * The recording's measured accents for a pattern of `steps` strokes per bar,
 * or null when they don't fit it (another meter or subdivision) or none stand out.
 */
export function recordingAccents(
  strumAccents: StrumAccents | null | undefined,
  beatsPerBar: number,
  steps: number,
): boolean[] | null {
  if (!strumAccents || strumAccents.beats_per_bar !== beatsPerBar) return null
  if (strumAccents.accents.length !== steps || !strumAccents.accents.some(Boolean)) return null
  return strumAccents.accents
}

/**
 * Strum patterns notated in the song's tab, one per section. Accents are the
 * ones measured on the recording when they fit, otherwise the tab's snare beats.
 */
export function getTabStrumPatterns(tabRhythm: TabRhythm, strumAccents?: StrumAccents | null): SectionStrumPattern[] {
  return tabRhythm.strum_patterns.map((tabPattern) => {
    const measured = recordingAccents(strumAccents, tabRhythm.beats_per_bar, tabPattern.steps.length)
    return {
      name: tabPattern.name,
      pattern: tabPattern.steps.map((step) => directionToSymbol(step.direction)),
      stepsPerBeat: tabPattern.subdivision,
      accents: measured ?? tabPattern.steps.map((step) => step.accent),
      accentSource: measured ? 'recording' : 'snare',
      barShare: tabPattern.bar_share,
    }
  })
}

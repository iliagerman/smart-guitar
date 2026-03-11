import type { ChordEntry, RhythmInfo, StrumEvent } from '@/types/song'
import { buildGridSlots, chooseSubdivision, quantizeStrumsToSlots, type GridSlot, type QuantizedStrum } from './strum-grid'

export interface StrumSymbol {
  symbol: string
  className: string
  title: string
  direction: 'down' | 'up'
}

export interface StrumGridCell {
  countLabel: string | null
  symbol: string | null
  className: string
  title: string | null
  direction: 'down' | 'up' | null
}

type RenderableStrum = StrumEvent & {
  direction: 'down' | 'up'
}

type SuggestedStrum = StrumEvent & {
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

function isRenderableStrum(strum: StrumEvent): strum is RenderableStrum {
  if (strum.direction === 'ambiguous') return false

  // Beat-aligned fallback strums are synthetic placeholders with no onset evidence.
  // Rendering them makes every song look like a generic D/U exercise, which is
  // more misleading than helpful.
  return strum.num_strings > 0 || strum.onset_spread_ms > 0
}

export function getRenderableStrums(strums: StrumEvent[]) {
  return strums.filter(isRenderableStrum)
}

function isSuggestedStrum(strum: StrumEvent): strum is SuggestedStrum {
  return strum.direction !== 'ambiguous' && !isRenderableStrum(strum)
}

function getSyntheticFallbackStrums(strums: StrumEvent[]) {
  return strums.filter(isSuggestedStrum)
}

export function getSuggestedStrums(start: number, end: number, strums: StrumEvent[]) {
  return getSyntheticFallbackStrums(strums).filter(
    (strum) => strum.start_time >= start - 0.05 && strum.start_time < end
  )
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

export function getStrumGridPattern(
  start: number,
  end: number,
  strums: StrumEvent[],
  opts?: {
    rhythm?: RhythmInfo | null
  }
): StrumGridCell[] {
  const { slots, quantized, isSuggested } = getStrumGridDisplay(start, end, strums, opts)
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
      title: isSuggested
        ? `suggested ${qs.direction} strum`
        : getDirectionTitle(qs.direction, qs.confidence),
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

    return getSuggestedStrums(start, end, strums).map((s) => ({
      symbol: getDirectionSymbol(s.direction),
      className: getDirectionClassName(s.direction),
      title: `suggested ${s.direction} strum`,
      direction: s.direction,
    }))
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

  const best = [...buckets.values()].sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count
    return b.pattern.length - a.pattern.length
  })[0]
  if (best) {
    return best.pattern.slice(0, maxSymbols)
  }

  const fallback = getRenderableStrums(strums)
    .slice(0, maxSymbols)
    .map((s) => ({
      symbol: getDirectionSymbol(s.direction),
      className: getDirectionClassName(s.direction),
      title: getDirectionTitle(s.direction, s.confidence),
      direction: s.direction,
    }))

  if (fallback.length > 0) {
    return fallback
  }

  return strums
    .filter((s): s is SuggestedStrum => isSuggestedStrum(s))
    .slice(0, maxSymbols)
    .map((s) => ({
      symbol: getDirectionSymbol(s.direction),
      className: getDirectionClassName(s.direction),
      title: `suggested ${s.direction} strum`,
      direction: s.direction,
    }))
}

import type { ChordEntry, RhythmInfo, SongSection, StrumEvent } from '@/types/song'

function directionToSymbol(direction: 'down' | 'up' | 'miss'): StrumSymbol {
  if (direction === 'miss') {
    return {
      symbol: '·',
      className: 'text-smoke-600',
      title: 'miss (skip)',
      direction: 'miss',
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

export interface StrumSymbol {
  symbol: string
  className: string
  title: string
  direction: 'down' | 'up' | 'miss'
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

export function getRenderableStrums(strums: StrumEvent[]) {
  return strums.filter(isDirectionalStrum)
}

export function getSuggestedStrums(_start: number, _end: number, _strums: StrumEvent[]) {
  // No suggested strums — all external strums are real
  return [] as DirectionalStrum[]
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

  const best = [...buckets.values()].sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count
    return b.pattern.length - a.pattern.length
  })[0]
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
  llm_generated?: boolean
}

/**
 * Normalize a section name to a canonical form for grouping.
 * "Verse 1", "Verse 2" → "Verse"; "Chorus" stays "Chorus".
 */
function canonicalSectionName(name: string): string {
  return name.replace(/\s*\d+$/, '').trim()
}

/**
 * Get the effective strum pattern for a section.
 * Prefers llm_pattern (from Tavily+LLM), falls back to strum_pattern.
 */
function getEffectivePattern(section: SongSection): ('down' | 'up' | 'miss')[] | null {
  return section.llm_pattern ?? section.strum_pattern ?? null
}

/**
 * Build section strum patterns from pre-computed strum_pattern on each section.
 * Groups by canonical section name (e.g. "Verse 1" + "Verse 2" → "Verse"),
 * picks the most common pattern per group, and skips non-playable sections.
 */
export function getSectionStrumPatterns(
  sections: SongSection[],
): SectionStrumPattern[] {
  if (sections.length === 0) return []

  // Skip sections that aren't useful for strumming guidance
  const skipSections = new Set(['intro', 'outro', 'instrumental', 'solo', 'breakdown', 'post-chorus', 'interlude'])

  // Group sections by canonical name, pick most common pattern
  const groups = new Map<string, Map<string, { pattern: ('down' | 'up' | 'miss')[]; count: number }>>()

  for (const section of sections) {
    const pattern = getEffectivePattern(section)
    if (!pattern || pattern.length < 2) continue

    const canonical = canonicalSectionName(section.name)
    if (skipSections.has(canonical.toLowerCase())) continue

    const key = pattern.join('')
    if (!groups.has(canonical)) groups.set(canonical, new Map())
    const bucket = groups.get(canonical)!
    const existing = bucket.get(key)
    if (existing) {
      existing.count += 1
    } else {
      bucket.set(key, { pattern, count: 1 })
    }
  }

  const result: SectionStrumPattern[] = []
  const seenPatterns = new Set<string>()

  for (const [name, bucket] of groups) {
    // Pick most common pattern for this section type
    const best = [...bucket.values()].sort((a, b) => b.count - a.count)[0]
    if (!best) continue

    const patternKey = best.pattern.join('')
    // Skip if we've already shown an identical pattern under a different name
    if (seenPatterns.has(patternKey)) continue
    seenPatterns.add(patternKey)

    const isLlm = sections.some(
      (s) => canonicalSectionName(s.name) === name && s.llm_pattern?.length,
    )

    result.push({
      name,
      pattern: best.pattern.map(directionToSymbol),
      llm_generated: isLlm || undefined,
    })
  }

  return result
}

import type { RhythmInfo, StrumEvent } from '@/types/song'
import { buildGridSlots, chooseSubdivision, quantizeStrumsToSlots } from './strum-grid'

export interface StrumSymbol {
  symbol: string
  className: string
  title: string
  direction: 'down' | 'up'
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

  if (rhythm && Array.isArray(rhythm.beat_times) && rhythm.beat_times.length >= 2) {
    const subdivision = chooseSubdivision('auto', start, end, rhythm, strums)
    const slots = buildGridSlots(start, end, rhythm, subdivision)
    const quantized = quantizeStrumsToSlots(slots, strums)

    const pattern: StrumSymbol[] = []
    for (let i = 0; i < slots.length; i++) {
      const qs = quantized.get(i)
      if (!qs) continue
      pattern.push({
        symbol: qs.direction === 'down' ? 'D' : 'U',
        className: qs.direction === 'down' ? 'text-emerald-400' : 'text-amber-400',
        title: `${qs.direction} strum (${Math.round(qs.confidence * 100)}%)`,
        direction: qs.direction,
      })
    }
    return pattern
  }

  const pattern: StrumSymbol[] = []
  for (const s of strums) {
    if (s.start_time >= start - 0.05 && s.start_time < end) {
      if (s.direction === 'ambiguous') continue
      pattern.push({
        symbol: s.direction === 'down' ? 'D' : 'U',
        className: s.direction === 'down' ? 'text-emerald-400' : 'text-amber-400',
        title: `${s.direction} strum (${Math.round(s.confidence * 100)}%)`,
        direction: s.direction,
      })
    }
  }
  return pattern
}

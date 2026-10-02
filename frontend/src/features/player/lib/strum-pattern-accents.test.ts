import { describe, expect, it } from 'vitest'

import type { TabRhythm } from '@/types/song'
import { getTabStrumPatterns } from './strum-pattern'

const tab: TabRhythm = {
  beats_per_bar: 4,
  beat_accents: [0, 0.9, 0, 0.9],
  strum_patterns: [{
    name: 'Verse',
    subdivision: 2,
    bar_share: 0.8,
    steps: ['down', 'miss', 'down', 'up', 'miss', 'up', 'down', 'up'].map((direction, i) => ({
      direction: direction as 'down' | 'up' | 'miss',
      accent: i === 2 || i === 6,
    })),
  }],
}
const measured = {
  beats_per_bar: 4,
  steps_per_beat: 2,
  accents: [false, false, true, false, false, true, false, false],
  strength: [0.9, 0.4, 1.2, 0.6, 1.0, 1.24, 1.0, 1.18],
  bars: 100,
}

describe('getTabStrumPatterns', () => {
  it('marks the snare beats without a measurement', () => {
    const [verse] = getTabStrumPatterns(tab)
    expect(verse.accents).toEqual([false, false, true, false, false, false, true, false])
    expect(verse.accentSource).toBe('snare')
  })

  it('prefers the accents measured on the recording when they fit the pattern', () => {
    const [verse] = getTabStrumPatterns(tab, measured)
    expect(verse.accents).toEqual(measured.accents)
    expect(verse.accentSource).toBe('recording')
  })
})

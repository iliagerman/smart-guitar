import { describe, it, expect } from 'vitest'
import { formatChordDisplayName } from './chord-utils'
import { chordNameToDbLookup } from '@/features/player/lib/chord-voicings'

describe('formatChordDisplayName', () => {
  it('names every chord quality the chord detector outputs', () => {
    const names = ['min', 'maj', 'dim', 'aug', 'min6', 'maj6', 'min7', 'minmaj7', 'maj7', '7', 'dim7', 'hdim7', 'sus2', 'sus4']
      .map((quality) => formatChordDisplayName(`A:${quality}`))
    expect(names).toEqual(['Am', 'A', 'Adim', 'Aaug', 'Am6', 'A6', 'Am7', 'AmM7', 'Amaj7', 'A7', 'Adim7', 'Am7b5', 'Asus2', 'Asus4'])
  })

  it('has a chord diagram for each of them', () => {
    for (const quality of ['min6', 'maj6', 'minmaj7', 'hdim7', 'dim7', 'aug', 'sus2']) {
      expect(chordNameToDbLookup(`C#:${quality}`)).not.toBeNull()
    }
  })
})

import { describe, expect, it } from 'vitest'
import { simplifyChords, toOpenChord } from './chord-simplifier'

describe('toOpenChord', () => {
  it('keeps the pitch of every chord', () => {
    expect(toOpenChord('F')).toBe('Fmaj7')
    expect(toOpenChord('Bm7')).toBe('Bm7')
    expect(toOpenChord('B')).toBe('B7')
    expect(toOpenChord('Bb')).toBe('A#')
    expect(toOpenChord('F#m7')).toBe('F#m')
    expect(toOpenChord('Cmaj7')).toBe('C')
    expect(toOpenChord('N')).toBe('N')
  })

  it('never maps a chord to a different root', () => {
    const chords = ['F', 'Bb', 'Gm', 'Am'].map((chord, i) => ({ start_time: i, end_time: i + 1, chord }))
    expect(simplifyChords(chords).map((c) => c.chord)).toEqual(['Fmaj7', 'A#', 'Gm', 'Am'])
  })
})

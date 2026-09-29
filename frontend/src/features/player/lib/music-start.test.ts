import { describe, expect, it } from 'vitest'
import { musicStartTime } from './music-start'

const chord = (start_time: number, name: string) => ({ start_time, end_time: start_time + 2, chord: name, bass: null })

describe('musicStartTime', () => {
  it('lands just before the first chord after a long silent intro', () => {
    expect(musicStartTime([chord(1.4, 'N'), chord(16.2, 'F#m'), chord(17.6, 'A')])).toBeCloseTo(15.2)
  })

  it('keeps short intros: the song starts at 0', () => {
    expect(musicStartTime([chord(0.5, 'N'), chord(2.5, 'G')])).toBe(0)
    expect(musicStartTime([chord(0, 'Em')])).toBe(0)
  })

  it('is 0 without any real chord', () => {
    expect(musicStartTime([])).toBe(0)
    expect(musicStartTime([chord(0, 'N'), chord(30, 'X')])).toBe(0)
  })
})

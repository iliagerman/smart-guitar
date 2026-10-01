import { describe, expect, it } from 'vitest'
import type { ChordEntry } from '@/types/song'
import { holdLabel, nearestBeatIndex, splitIntoBars, type BarChord } from './chord-beats'

// 0.5 s beats from 1 s: bars start at 1, 3, 5, 7, ...
const beats = Array.from({ length: 33 }, (_, i) => 1 + i * 0.5)

const chord = (name: string, start: number, end: number): ChordEntry => ({ chord: name, start_time: start, end_time: end })

const summary = (laidOut: BarChord[]) =>
  laidOut.map((c) => [c.chord, c.hold?.first, c.hold?.count, !!c.continued, !!c.barStart])

/** Beats of chord per bar index, for the bars that hold any chord. */
function barTotals(laidOut: BarChord[], beatsPerBar: number): Map<number, number> {
  const totals = new Map<number, number>()
  for (const c of laidOut) {
    if (!c.hold) continue
    const bar = Math.floor(c.hold.first / beatsPerBar)
    expect(Math.floor((c.hold.first + c.hold.count - 1) / beatsPerBar)).toBe(bar)
    totals.set(bar, (totals.get(bar) ?? 0) + c.hold.count)
  }
  return totals
}

describe('nearestBeatIndex', () => {
  it('snaps to the closest beat on either side', () => {
    expect(nearestBeatIndex(beats, 0)).toBe(0)
    expect(nearestBeatIndex(beats, 1.2)).toBe(0)
    expect(nearestBeatIndex(beats, 1.3)).toBe(1)
    expect(nearestBeatIndex(beats, 99)).toBe(32)
  })
})

describe('splitIntoBars', () => {
  it('snaps changes to half bars, landing early or late', () => {
    const laidOut = splitIntoBars([chord('G', 0.97, 1.9), chord('C', 1.9, 3.1), chord('D', 3.1, 5)], beats)
    expect(summary(laidOut)).toEqual([
      ['G', 0, 2, false, true],
      ['C', 2, 2, false, false],
      ['D', 4, 4, false, true],
    ])
    expect(laidOut.map((c) => c.start_time)).toEqual([1, 2, 3])
  })

  it('gives a chord squeezed between two changes a beat of its own instead of overlapping', () => {
    // Like Wonderwall's F#m at 16.18-17.65 s: it rounds to the same half bar as the A after it.
    const laidOut = splitIntoBars(
      [chord('G', 1, 1.6), chord('F#m', 1.6, 1.9), chord('A', 1.9, 3.0), chord('E', 3.0, 5.0)],
      beats,
    )
    expect(summary(laidOut)).toEqual([
      ['G', 0, 2, false, true],
      ['F#m', 2, 1, false, false],
      ['A', 3, 1, false, false],
      ['E', 4, 4, false, true],
    ])
  })

  it('splits a chord held over a bar line, so each bar adds up to one', () => {
    const laidOut = splitIntoBars([chord('G', 1, 2), chord('C', 2, 5), chord('D', 5, 7)], beats)
    expect(summary(laidOut)).toEqual([
      ['G', 0, 2, false, true],
      ['C', 2, 2, false, false],
      ['C', 4, 4, true, true],
      ['D', 8, 4, false, true],
    ])
    expect(laidOut[2].start_time).toBe(3)
    expect([...barTotals(laidOut, 4).values()]).toEqual([4, 4, 4])
  })

  it('starts and ends silences on bar lines', () => {
    const laidOut = splitIntoBars(
      [chord('N', 0, 2.1), chord('G', 2.1, 3.9), chord('N', 3.9, 6), chord('C', 6, 8)],
      beats,
    )
    expect(summary(laidOut)).toEqual([
      ['N', undefined, undefined, false, false],
      ['G', 4, 4, false, true],
      ['N', undefined, undefined, false, false],
      ['C', 12, 4, false, true],
    ])
  })

  it('treats a gap between chords as silence and ignores a silence too short to fill a bar', () => {
    const gap = splitIntoBars([chord('G', 1, 3), chord('C', 5, 7)], beats)
    expect(summary(gap)).toEqual([
      ['G', 0, 4, false, true],
      ['C', 8, 4, false, true],
    ])
    const blip = splitIntoBars([chord('G', 1, 2.4), chord('N', 2.4, 2.6), chord('C', 2.6, 5)], beats)
    expect([...barTotals(blip, 4).values()]).toEqual([4, 4])
  })

  it('counts beats in odd meters', () => {
    const laidOut = splitIntoBars([chord('G', 0.97, 2.0), chord('C', 2.0, 3.6)], beats, 3)
    expect(summary(laidOut)).toEqual([
      ['G', 0, 2, false, true],
      ['C', 2, 1, false, false],
      ['C', 3, 3, true, true],
    ])
  })

  it('leaves chords off the grid, or every chord without one, as they were', () => {
    const chords = [chord('G', 0, 0.5), chord('C', 1, 3)]
    expect(splitIntoBars(chords, null)).toEqual(chords)
    expect(splitIntoBars(chords, [1])).toEqual(chords)
    expect(splitIntoBars([chord('G', 0, 0.5), chord('C', 99, 100)], beats).map((c) => c.hold)).toEqual([undefined, undefined])
  })

  it('fills every bar it touches with exactly one bar of chords, whatever the detected timing', () => {
    let seed = 7
    const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647
    for (let round = 0; round < 200; round++) {
      const chords: ChordEntry[] = []
      let time = random() * 2
      while (time < 17) {
        const length = 0.1 + random() * 2.5
        chords.push(chord(random() < 0.15 ? 'N' : 'G', time, time + length))
        time += length + (random() < 0.1 ? random() * 2 : 0)
      }
      for (const beatsPerBar of [3, 4, 6]) {
        const laidOut = splitIntoBars(chords, beats, beatsPerBar)
        for (const total of barTotals(laidOut, beatsPerBar).values()) expect(total).toBe(beatsPerBar)
        const held = laidOut.filter((c) => c.hold)
        held.slice(1).forEach((c, i) =>
          expect(c.hold!.first).toBeGreaterThanOrEqual(held[i].hold!.first + held[i].hold!.count),
        )
      }
    }
  })
})

describe('holdLabel', () => {
  it('names holds in bars, half a bar included, and odd short ones in beats', () => {
    expect(holdLabel(2, 4)).toBe('½ bar')
    expect(holdLabel(3, 6)).toBe('½ bar')
    expect(holdLabel(1, 4)).toBe('1 beat')
    expect(holdLabel(3, 4)).toBe('3 beats')
    expect(holdLabel(2, 3)).toBe('2 beats')
    expect(holdLabel(4, 4)).toBe('1 bar')
    expect(holdLabel(6, 4)).toBe('1½ bars')
    expect(holdLabel(8, 4)).toBe('2 bars')
    expect(holdLabel(3, 3)).toBe('1 bar')
  })
})

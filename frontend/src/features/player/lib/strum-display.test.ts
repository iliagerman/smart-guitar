import { describe, expect, it } from 'vitest'

import { directionToSymbol } from './strum-pattern'
import { mainPattern, starterPattern, strumStepAt } from './strum-display'

const beats = [1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5]

describe('strumStepAt', () => {
  it('follows a one-bar eighth-note pattern across the bar', () => {
    expect(strumStepAt(beats, 1, 8, 2)).toBe(0)
    expect(strumStepAt(beats, 1.3, 8, 2)).toBe(1)
    expect(strumStepAt(beats, 2.8, 8, 2)).toBe(7)
  })

  it('starts over on the next bar', () => {
    expect(strumStepAt(beats, 3.05, 8, 2)).toBe(0)
    expect(strumStepAt(beats, 3.8, 8, 2)).toBe(3)
  })

  it('is -1 outside the beats or for a pattern off the beat grid', () => {
    expect(strumStepAt(beats, 0.5, 8, 2)).toBe(-1)
    expect(strumStepAt(beats, 5, 8, 2)).toBe(-1)
    expect(strumStepAt(beats, 1, 7, 2)).toBe(-1)
  })
})

describe('mainPattern', () => {
  const down = [directionToSymbol('down')]

  it('picks the section pattern covering the most bars', () => {
    const verse = { name: 'Verse', pattern: down, barShare: 0.4 }
    const chorus = { name: 'Chorus', pattern: down, barShare: 0.9 }
    expect(mainPattern([verse, chorus])).toBe(chorus)
  })

  it('is null without patterns', () => {
    expect(mainPattern([])).toBeNull()
  })
})

describe('starterPattern', () => {
  it('fills one bar of the meter', () => {
    for (const meter of [3, 4]) {
      const starter = starterPattern(meter)
      expect(starter.pattern.length / (starter.stepsPerBeat ?? 1)).toBe(meter)
    }
  })
})

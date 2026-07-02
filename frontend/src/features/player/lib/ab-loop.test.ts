import { describe, it, expect } from 'vitest'
import { getLoopSeekTarget } from './ab-loop'

describe('getLoopSeekTarget', () => {
  it('returns null when no loop is set', () => {
    expect(getLoopSeekTarget({ isPlaying: true, loopStart: null, loopEnd: null, currentTime: 30 })).toBeNull()
  })

  it('returns null when only the start marker is set (loop pending)', () => {
    expect(getLoopSeekTarget({ isPlaying: true, loopStart: 10, loopEnd: null, currentTime: 30 })).toBeNull()
  })

  it('returns null when not playing, even past the loop end', () => {
    expect(getLoopSeekTarget({ isPlaying: false, loopStart: 10, loopEnd: 20, currentTime: 25 })).toBeNull()
  })

  it('returns null while inside the loop range', () => {
    expect(getLoopSeekTarget({ isPlaying: true, loopStart: 10, loopEnd: 20, currentTime: 15 })).toBeNull()
  })

  it('returns the loop start once current time reaches the loop end', () => {
    expect(getLoopSeekTarget({ isPlaying: true, loopStart: 10, loopEnd: 20, currentTime: 20 })).toBe(10)
  })

  it('returns the loop start once current time passes the loop end', () => {
    expect(getLoopSeekTarget({ isPlaying: true, loopStart: 10, loopEnd: 20, currentTime: 20.4 })).toBe(10)
  })
})

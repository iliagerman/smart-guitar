import { describe, it, expect } from 'vitest'
import { formatChordWithBass } from './chord-colors'

describe('formatChordWithBass', () => {
  it('appends the slash bass when enabled and present', () => {
    expect(formatChordWithBass('C:maj', 'G', true)).toBe('C/G')
    expect(formatChordWithBass('A:min', 'C', true)).toBe('Am/C')
  })

  it('omits the bass when the toggle is off', () => {
    expect(formatChordWithBass('C:maj', 'G', false)).toBe('C')
  })

  it('omits the bass when there is no bass note', () => {
    expect(formatChordWithBass('C:maj', null, true)).toBe('C')
    expect(formatChordWithBass('C:maj', undefined, true)).toBe('C')
  })
})

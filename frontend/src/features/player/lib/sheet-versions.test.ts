import { describe, it, expect } from 'vitest'
import { lyricsModeForActiveVersion } from './sheet-versions'
import type { ChordOption } from '@/types/song'

function makeOption(partial: Partial<ChordOption>): ChordOption {
  return {
    name: 'Sheet 1',
    description: 'Auto-detected chords',
    capo: 0,
    chords: [],
    ...partial,
  }
}

describe('lyricsModeForActiveVersion', () => {
  it('returns "none" for community sheets so per-word tracking is off', () => {
    const community = makeOption({
      description: 'Community chord sheet (Key: G)',
      lyrics_source: 'community',
    })
    expect(lyricsModeForActiveVersion(community)).toBe('none')
  })

  it('returns "highlight" for detected sheets so per-word tracking stays on', () => {
    const detected = makeOption({ description: 'Auto-detected chords' })
    expect(lyricsModeForActiveVersion(detected)).toBe('highlight')
  })

  it('returns "highlight" for user-saved sheets', () => {
    const userSheet = makeOption({
      description: 'Your saved chord edit',
      version_key: 'chords_user_v1',
    })
    expect(lyricsModeForActiveVersion(userSheet)).toBe('highlight')
  })

  it('returns "highlight" when no version is active', () => {
    expect(lyricsModeForActiveVersion(undefined)).toBe('highlight')
  })
})

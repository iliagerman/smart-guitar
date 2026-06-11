import { describe, it, expect } from 'vitest'
import { getSheetVersionDescription, lyricsModeForActiveVersion } from './sheet-versions'
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
  it('returns "none" for unsynced community sheets so per-word tracking is off', () => {
    const community = makeOption({
      description: 'Community chord sheet (Key: G)',
      lyrics_source: 'community',
    })
    expect(lyricsModeForActiveVersion(community)).toBe('none')
  })

  it('returns "highlight" for whisper-synced community sheets so auto-scroll follows the audio', () => {
    const synced = makeOption({
      description: 'Community chord sheet (Key: G) · synced to audio',
      lyrics_source: 'community',
      lyrics_synced: true,
    })
    expect(lyricsModeForActiveVersion(synced)).toBe('highlight')
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

describe('getSheetVersionDescription', () => {
  it('passes the backend description through for community sheets (shows synced marker)', () => {
    const synced = makeOption({
      description: 'Community chord sheet (Key: G) · synced to audio',
      lyrics_source: 'community',
      lyrics_synced: true,
    })
    expect(getSheetVersionDescription(synced)).toBe(
      'Community chord sheet (Key: G) · synced to audio',
    )
  })
})

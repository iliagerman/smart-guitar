import { describe, expect, it } from 'vitest'

import { hashString, seededShuffle } from './rotation'

const songs = Array.from({ length: 20 }, (_, i) => `song-${i}`)

describe('seededShuffle', () => {
  it('keeps every item', () => {
    expect([...seededShuffle(songs, 7)].sort()).toEqual([...songs].sort())
  })

  it('gives the same order for the same seed', () => {
    expect(seededShuffle(songs, 42)).toEqual(seededShuffle(songs, 42))
  })

  it('gives a different order for another visit', () => {
    expect(seededShuffle(songs, 42)).not.toEqual(seededShuffle(songs, 43))
  })
})

describe('hashString', () => {
  it('is stable and tells strips apart', () => {
    expect(hashString('campfire')).toBe(hashString('campfire'))
    expect(hashString('campfire')).not.toBe(hashString('love-songs'))
  })
})

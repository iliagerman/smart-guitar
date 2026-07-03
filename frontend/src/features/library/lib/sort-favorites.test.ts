import { describe, it, expect } from 'vitest'
import { sortFavorites } from './sort-favorites'
import type { Favorite } from '@/types/favorite'

function makeFavorite(id: string, createdAt: string, playCount: number): Favorite {
  return {
    id,
    user_id: 'user-1',
    song_id: `song-${id}`,
    created_at: createdAt,
    updated_at: createdAt,
    song: {
      id: `song-${id}`,
      youtube_id: null,
      title: `Song ${id}`,
      artist: null,
      duration_seconds: null,
      song_name: `song_${id}`,
      thumbnail_key: null,
      thumbnail_url: null,
      audio_key: null,
      play_count: playCount,
      created_at: createdAt,
    },
  }
}

describe('sortFavorites', () => {
  it('sorts by created_at descending in "recent" mode', () => {
    const oldest = makeFavorite('a', '2024-01-01T00:00:00Z', 5)
    const middle = makeFavorite('b', '2024-06-01T00:00:00Z', 20)
    const newest = makeFavorite('c', '2024-12-01T00:00:00Z', 1)

    const result = sortFavorites([oldest, middle, newest], 'recent')

    expect(result.map((f) => f.id)).toEqual(['c', 'b', 'a'])
  })

  it('sorts by song play_count descending in "most_played" mode', () => {
    const lowPlays = makeFavorite('a', '2024-01-01T00:00:00Z', 5)
    const highPlays = makeFavorite('b', '2024-02-01T00:00:00Z', 50)
    const midPlays = makeFavorite('c', '2024-03-01T00:00:00Z', 20)

    const result = sortFavorites([lowPlays, highPlays, midPlays], 'most_played')

    expect(result.map((f) => f.id)).toEqual(['b', 'c', 'a'])
  })

  it('breaks play_count ties by favorite created_at descending', () => {
    const tiedOlder = makeFavorite('a', '2024-01-01T00:00:00Z', 10)
    const tiedNewer = makeFavorite('b', '2024-06-01T00:00:00Z', 10)

    const result = sortFavorites([tiedOlder, tiedNewer], 'most_played')

    expect(result.map((f) => f.id)).toEqual(['b', 'a'])
  })

  it('treats a missing play_count as zero', () => {
    const noSong = { ...makeFavorite('a', '2024-01-01T00:00:00Z', 0), song: undefined }
    const withPlays = makeFavorite('b', '2023-01-01T00:00:00Z', 3)

    const result = sortFavorites([noSong, withPlays], 'most_played')

    expect(result.map((f) => f.id)).toEqual(['b', 'a'])
  })

  it('does not mutate the input array', () => {
    const first = makeFavorite('a', '2024-01-01T00:00:00Z', 5)
    const second = makeFavorite('b', '2024-06-01T00:00:00Z', 5)
    const input = [first, second]

    sortFavorites(input, 'recent')

    expect(input).toEqual([first, second])
  })
})

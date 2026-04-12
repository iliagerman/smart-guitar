import { api } from '../config/api'
import type { MessageResponse, PaginatedResponse } from '../types/api'
import type { ChordEntry, LyricsSegment, Song, SongDetail, SongSection, SearchResult } from '../types/song'

interface SaveUserChordsPayload {
  name: string
  description: string
  capo: number
  chords: ChordEntry[]
  lyrics?: LyricsSegment[] | null
}

export interface SaveUserChordsResponse {
  detail: SongDetail
  saved: boolean
  duplicate_of: string | null
}

interface ChordVersionVoteResponse {
  version_key: string
  vote_score: number
}

interface RegenerateResponse {
  enqueued: string[]
  skipped: string[]
  errors: string[]
}

interface PlaybackSourceResponse {
  url: string
}

export const songsApi = {
  search: (query: string) =>
    api.post<{ results: SearchResult[] }>('/api/v1/songs/search', { query }).then((r) => r.data.results),

  select: (songName: string, youtubeId: string) =>
    api.post<SongDetail>('/api/v1/songs/select', { song_name: songName, youtube_id: youtubeId }).then((r) => r.data),

  download: (youtubeId: string) =>
    api.post<Song>('/api/v1/songs/download', { youtube_id: youtubeId }).then((r) => r.data),

  list: (params?: { query?: string; offset?: number; limit?: number }) =>
    api
      .get<PaginatedResponse<Song>>('/api/v1/songs', { params })
      .then((r) => r.data),

  recent: (limit = 10) =>
    // Backend returns PaginatedSongsResponse here too.
    api
      .get<PaginatedResponse<Song>>('/api/v1/songs/recent', { params: { limit } })
      .then((r) => r.data.items),

  detail: (songId: string) =>
    api.get<SongDetail>(`/api/v1/songs/${songId}`).then((r) => r.data),

  playbackSource: (songId: string, stems: string[], signal?: AbortSignal) =>
    api
      .get<PlaybackSourceResponse>(`/api/v1/songs/${songId}/playback-source`, {
        params: { stems: stems.join(',') },
        signal,
      })
      .then((r) => r.data),

  recordPlay: (songId: string) =>
    api.post<MessageResponse>(`/api/v1/songs/${songId}/play`).then((r) => r.data),

  submitFeedback: (songId: string, rating: 'thumbs_up' | 'thumbs_down', comment?: string) =>
    api.post<MessageResponse>(`/api/v1/songs/${songId}/feedback`, { rating, comment }).then((r) => r.data),

  generateAiStrumPatterns: (songId: string) =>
    api.post<SongSection[]>(`/api/v1/songs/${songId}/strum-patterns/ai`).then((r) => r.data),

  regenerate: (songId: string, targets: string[]) =>
    api
      .post<RegenerateResponse>(
        `/api/v1/songs/${songId}/regenerate`,
        { targets },
      )
      .then((r) => r.data),

  saveChords: (songId: string, data: SaveUserChordsPayload) =>
    api.put<SaveUserChordsResponse>(`/api/v1/songs/${songId}/chords`, data).then((r) => r.data),

  deleteChords: (songId: string) =>
    api.delete<SongDetail>(`/api/v1/songs/${songId}/chords`).then((r) => r.data),

  voteChordVersion: (songId: string, versionKey: string, vote: number) =>
    api
      .post<ChordVersionVoteResponse>(`/api/v1/songs/${songId}/chord-votes`, {
        version_key: versionKey,
        vote,
      })
      .then((r) => r.data),

  recommendations: (songId: string, limit = 10) =>
    api
      .get<{ items: Song[]; seed_song_id: string }>(`/api/v1/songs/${songId}/recommendations`, {
        params: { limit },
      })
      .then((r) => r.data.items),
}

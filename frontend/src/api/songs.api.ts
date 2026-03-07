import { api } from '../config/api'
import type { Song, SongDetail, SearchResult } from '../types/song'

export type PaginatedResponse<T> = {
  items: T[]
  total: number
  offset: number
  limit: number
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

  submitFeedback: (songId: string, rating: 'thumbs_up' | 'thumbs_down', comment?: string) =>
    api.post(`/api/v1/songs/${songId}/feedback`, { rating, comment }),
}

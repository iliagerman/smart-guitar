import { api } from '../config/api'
import type { MessageResponse } from '../types/api'
import type { Favorite } from '../types/favorite'

export const favoritesApi = {
  list: () =>
    api.get<{ favorites: Favorite[] }>('/api/v1/favorites').then((r) => r.data.favorites),

  add: (songId: string) =>
    api.post<Favorite>('/api/v1/favorites', { song_id: songId }).then((r) => r.data),

  remove: (songId: string) =>
    api.delete<MessageResponse>(`/api/v1/favorites/${songId}`).then((r) => r.data),
}

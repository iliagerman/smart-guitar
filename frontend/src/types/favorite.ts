export interface Favorite {
  id: string
  user_id: string
  song_id: string
  created_at: string
  updated_at: string
  song?: import('./song').Song
}

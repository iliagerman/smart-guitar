export interface Favorite {
  id: string
  user_id: string
  song_id: string
  created_at: string
  updated_at: string
  song?: import('./song').Song
  /** How often you played the song; song.play_count counts everyone's plays. */
  my_play_count?: number
}

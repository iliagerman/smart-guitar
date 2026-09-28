import type { Song, SongDifficulty } from './song'

export type SkillLevel = 'beginner' | 'intermediate' | 'advanced'

/** The four steps of a song's practice path. */
export type PracticeStep = 1 | 2 | 3 | 4

export interface PracticeProgress {
  song_id: string
  current_step: PracticeStep
  completed_steps: PracticeStep[]
  learned_chords: string[]
  /** Best fraction of the song played through on stage (step 3), 0..1. */
  stage_progress: number
  last_practiced_at: string | null
}

export interface PracticeSongProgress {
  song: Song
  progress: PracticeProgress
}

export interface PracticeSummary {
  skill_level: SkillLevel | null
  streak_days: number
  practiced_today: boolean
  continue_songs: PracticeSongProgress[]
}

export interface SavePracticeProgressPayload {
  current_step: PracticeStep
  completed_steps: PracticeStep[]
  learned_chords: string[]
  stage_progress: number
}

export type SetlistMode = 'play_along' | 'drums_bass' | 'learn'

export interface Setlist {
  id: string
  title: string
  description: string
  level: SongDifficulty
  suggested_mode: SetlistMode
  song_count: number
  cover_urls: string[]
}

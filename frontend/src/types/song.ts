export interface Song {
  id: string
  youtube_id: string | null
  title: string
  artist: string | null
  duration_seconds: number | null
  song_name: string
  thumbnail_key: string | null
  thumbnail_url: string | null
  audio_key: string | null
}

export interface SongStems {
  [key: string]: string | null
}

export interface StemType {
  name: string
  label: string
}

export interface ChordEntry {
  start_time: number
  end_time: number
  chord: string
}

export interface LyricsWord {
  word: string
  start: number
  end: number
}

export interface LyricsSegment {
  start: number
  end: number
  text: string
  words: LyricsWord[]
}

export interface ChordOption {
  name: string
  description: string
  capo: number
  chords: ChordEntry[]
}

export interface TabNote {
  start_time: number
  end_time: number
  string: number
  fret: number
  midi_pitch: number
  confidence: number
}

export interface StrumEvent {
  id: number
  start_time: number
  end_time: number
  direction: 'down' | 'up' | 'ambiguous'
  confidence: number
  num_strings: number
  onset_spread_ms: number
}

export interface RhythmInfo {
  bpm: number
  beat_times: number[]
}

export interface SongSection {
  name: string
  start_time: number
  end_time: number
  strum_pattern: ('down' | 'up' | 'miss')[]
  songsterr_pattern?: ('down' | 'up' | 'miss')[] | null
  llm_pattern?: ('down' | 'up' | 'miss')[] | null
  llm_generated?: boolean
}

export interface ActiveJobInfo {
  id: string
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED'
  progress: number
  stage: string | null
}

export interface SongDetail {
  song: Song
  thumbnail_url: string | null
  audio_url: string | null
  stems: SongStems
  stem_types: StemType[]
  chords: ChordEntry[]
  lyrics: LyricsSegment[]
  lyrics_source: string | null
  quick_lyrics: LyricsSegment[]
  quick_lyrics_source: string | null
  corrected_lyrics: LyricsSegment[]
  corrected_lyrics_source: string | null
  ver1_lyrics?: LyricsSegment[]
  ver1_lyrics_source?: string | null
  ver2_lyrics?: LyricsSegment[]
  ver2_lyrics_source?: string | null
  ver3_lyrics?: LyricsSegment[]
  ver3_lyrics_source?: string | null
  ver4_lyrics?: LyricsSegment[]
  ver4_lyrics_source?: string | null
  chord_options: ChordOption[]
  tabs: TabNote[]
  tabs_source?: string | null
  strums: StrumEvent[]
  rhythm: RhythmInfo | null
  sections: SongSection[]
  source_bpm?: number | null
  time_signature?: [number, number] | null
  strum_notes?: string | null
  tutorial_url?: string | null
  tutorial_links?: { url: string; title: string }[]
  songsterr_status?: string | null  // null=pending, "ready", "failed", "unavailable"
  chord_source?: string | null  // "gemini" | "autochord"
  recommended_capo?: number | null
  song_key?: string | null
  web_chords_failed?: boolean
  active_job: ActiveJobInfo | null
  download_pending: boolean
}

export interface SearchResult {
  artist: string
  song: string
  youtube_id: string
  title: string
  link: string
  thumbnail_url: string | null
  duration_seconds: number | null
  view_count: number | null
  exists_locally: boolean
  song_id: string | null
}

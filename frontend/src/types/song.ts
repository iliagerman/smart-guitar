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
  strum_id: number | null
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
  chord_options: ChordOption[]
  tabs: TabNote[]
  strums: StrumEvent[]
  rhythm: RhythmInfo | null
  active_job: ActiveJobInfo | null
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

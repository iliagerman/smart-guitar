import type { LyricsHighlightMode, LyricsSourceMode } from '@/stores/player-prefs.store'
import type { SheetMode } from '@/stores/playback.store'
import type { ChordOption } from '@/types/song'

import { getSheetVersionLabel, lyricsModeForActiveVersion } from './sheet-versions'

export interface PlaybackSnapshotInput {
  sheet: ChordOption | undefined
  sheetIndex: number
  lyricsMode: LyricsHighlightMode
  /** What the member picked in the lyrics menu. */
  lyricsChoice: LyricsSourceMode
  /** Where the lyrics on screen came from, e.g. "lrclib_synced+whisper" or "community". */
  lyricsSource: string | null
  lyricsOffsetMs: number
  isFullSong: boolean
  activeStems: string[]
  stemsLocked: boolean
  playbackRate: number
  transposeSemitones: number
  sheetMode: SheetMode
  countInEnabled: boolean
  skipInstrumentals: boolean
}

/**
 * How the player was set up, for analytics: enough to tell why what a member
 * saw (the sheet and its highlighting) may not have matched what they heard.
 */
export function buildPlaybackSnapshot(input: PlaybackSnapshotInput): Record<string, unknown> {
  // One stem or the full mix streams through a single audio element; several stems go through the mixer.
  const singleSource = input.isFullSong || input.activeStems.length === 1
  return {
    plan: input.stemsLocked ? 'free' : 'pro',
    audio: input.isFullSong ? 'full_song' : input.activeStems.join('+'),
    audio_engine: singleSource ? 'single' : 'mixer',
    sheet: getSheetVersionLabel(input.sheet, input.sheetIndex),
    // "estimated": a community sheet whose lines were spread over the song, not aligned to the audio.
    sheet_timing: lyricsModeForActiveVersion(input.sheet) === 'highlight' ? 'audio' : 'estimated',
    lyrics_mode: input.lyricsMode,
    lyrics_choice: input.lyricsChoice,
    ...(input.lyricsSource ? { lyrics_source: input.lyricsSource } : {}),
    lyrics_offset_ms: input.lyricsOffsetMs,
    playback_rate: input.playbackRate,
    transpose: input.transposeSemitones,
    sheet_mode: input.sheetMode,
    count_in: input.countInEnabled,
    skip_instrumentals: input.skipInstrumentals,
  }
}

export interface PlaybackRun {
  startedAtMs: number
  endedAtMs: number
  /** How far the playback clock advanced, not counting jumps from seeks or loops. */
  audioSeconds: number
  seeks: number
  position: number
  duration: number
}

function oneDecimal(value: number): number {
  return Math.round(value * 10) / 10
}

/** One stretch of playback, from pressing play to it stopping. */
export function summarizePlaybackRun(run: PlaybackRun): Record<string, unknown> {
  return {
    position: oneDecimal(run.position),
    played_seconds: oneDecimal((run.endedAtMs - run.startedAtMs) / 1000),
    audio_seconds: oneDecimal(run.audioSeconds),
    seeks: run.seeks,
    // An ended song parks at its duration.
    ended: run.duration > 0 && run.position >= run.duration - 1,
  }
}

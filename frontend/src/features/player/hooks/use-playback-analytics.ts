import { useEffect, useRef } from 'react'

import { analyticsTracker } from '@/lib/event-tracker'
import { usePlaybackStore } from '@/stores/playback.store'
import { usePlayerPrefsStore, type LyricsSourceMode } from '@/stores/player-prefs.store'
import type { ChordOption } from '@/types/song'

import { buildPlaybackSnapshot, summarizePlaybackRun } from '../lib/playback-snapshot'

interface UsePlaybackAnalyticsOptions {
  songId: string | undefined
  songTitle: string | undefined
  sheet: ChordOption | undefined
  sheetIndex: number
  lyricsChoice: LyricsSourceMode
  lyricsSource: string | null
  lyricsOffsetMs: number
  transposeSemitones: number
  stemsLocked: boolean
}

// The playback clock is published about 20 times a second; a bigger step is a seek or a loop wrap.
const MAX_CLOCK_STEP_SECONDS = 1.5
// A member nudging the lyrics offset taps several times; report where they settled.
const SETTINGS_SETTLE_MS = 1500

interface ActiveRun {
  startedAtMs: number
  audioSeconds: number
  seeks: number
  lastTime: number
}

function currentSnapshot(options: UsePlaybackAnalyticsOptions): Record<string, unknown> {
  const playback = usePlaybackStore.getState()
  const prefs = usePlayerPrefsStore.getState()
  return buildPlaybackSnapshot({
    sheet: options.sheet,
    sheetIndex: options.sheetIndex,
    lyricsMode: prefs.lyricsMode,
    lyricsChoice: options.lyricsChoice,
    lyricsSource: options.lyricsSource,
    lyricsOffsetMs: options.lyricsOffsetMs,
    isFullSong: playback.isFullSong,
    activeStems: playback.activeStems,
    stemsLocked: options.stemsLocked,
    playbackRate: playback.playbackRate,
    transposeSemitones: options.transposeSemitones,
    sheetMode: playback.sheetMode,
    countInEnabled: prefs.countInEnabled,
    skipInstrumentals: prefs.skipInstrumentals,
  })
}

function trackPlayerEvent(
  eventType: string,
  options: UsePlaybackAnalyticsOptions,
  properties: Record<string, unknown>,
): void {
  analyticsTracker.track({
    event_type: eventType,
    event_category: 'player',
    song_id: options.songId,
    song_title: options.songTitle,
    properties,
  })
}

/**
 * Records how each play of the song went: `playback_started` with the player's
 * setup (plan, audio engine, sheet and its timing, lyrics mode, source and
 * offset), `playback_stopped` with how long it ran against how far the audio
 * moved, and `player_settings_changed` when the sheet or lyrics setup changes
 * after playback began. Together with the device sent on every batch, the
 * analytics dashboard can explain a "the highlight was out of sync" report.
 */
export function usePlaybackAnalytics(options: UsePlaybackAnalyticsOptions): void {
  const { songId, sheetIndex, lyricsChoice, lyricsOffsetMs } = options
  const sheetName = options.sheet?.name
  const lyricsMode = usePlayerPrefsStore((s) => s.lyricsMode)
  const hasPlaybackOccurred = usePlaybackStore((s) => s.hasPlaybackOccurred)
  const optionsRef = useRef(options)
  useEffect(() => {
    optionsRef.current = options
  })

  useEffect(() => {
    if (!songId) return

    let run: ActiveRun | null = null
    const stopRun = () => {
      if (!run) return
      const playback = usePlaybackStore.getState()
      trackPlayerEvent('playback_stopped', optionsRef.current, summarizePlaybackRun({
        startedAtMs: run.startedAtMs,
        endedAtMs: performance.now(),
        audioSeconds: run.audioSeconds,
        seeks: run.seeks,
        position: playback.currentTime,
        duration: playback.duration,
      }))
      run = null
    }

    const unsubscribe = usePlaybackStore.subscribe((state, prev) => {
      if (state.currentSongId !== songId) return
      if (state.isPlaying && !prev.isPlaying) {
        run = { startedAtMs: performance.now(), audioSeconds: 0, seeks: 0, lastTime: state.currentTime }
        trackPlayerEvent('playback_started', optionsRef.current, {
          position: Math.round(state.currentTime * 10) / 10,
          ...currentSnapshot(optionsRef.current),
        })
        return
      }
      if (!state.isPlaying && prev.isPlaying) {
        stopRun()
        return
      }
      if (run && state.currentTime !== run.lastTime) {
        const step = state.currentTime - run.lastTime
        if (step > 0 && step <= MAX_CLOCK_STEP_SECONDS) run.audioSeconds += step
        else run.seeks += 1
        run.lastTime = state.currentTime
      }
    })

    return () => {
      unsubscribe()
      // Leaving the page mid-song.
      stopRun()
    }
  }, [songId])

  // Setup changes made once the song has been played; before that, `playback_started` carries the setup.
  const reportedSetupRef = useRef<string | null>(null)
  useEffect(() => {
    if (!songId || !hasPlaybackOccurred) {
      reportedSetupRef.current = null
      return
    }
    const setup = `${songId}|${sheetIndex}:${sheetName}|${lyricsMode}|${lyricsChoice}|${lyricsOffsetMs}`
    if (reportedSetupRef.current === null) {
      reportedSetupRef.current = setup
      return
    }
    if (reportedSetupRef.current === setup) return

    const timer = window.setTimeout(() => {
      reportedSetupRef.current = setup
      trackPlayerEvent('player_settings_changed', optionsRef.current, currentSnapshot(optionsRef.current))
    }, SETTINGS_SETTLE_MS)
    return () => window.clearTimeout(timer)
  }, [songId, hasPlaybackOccurred, sheetIndex, sheetName, lyricsMode, lyricsChoice, lyricsOffsetMs])
}

import { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react'
import { usePlaybackStore } from '@/stores/playback.store'
import { usePlayerPrefsStore } from '@/stores/player-prefs.store'
import type { TabsSheetLine } from '../lib/merge-tabs-lyrics'

/** Max gap (seconds) to keep the previous line highlighted after it ends. */
const PREV_LINE_LINGER_S = 0.8
/** Max gap (seconds) to look ahead and highlight the upcoming line. */
const NEXT_LINE_LOOKAHEAD_S = 0.5

interface SyncState {
  activeLineIndex: number
  activeWordIndex: number
  /** Start time of the currently active note bucket (notes within 50ms share a bucket). -1 if none. */
  activeNoteTime: number
}

function computeSync(
  lines: TabsSheetLine[],
  params: { rawTime: number; adjustedLyricsTime: number }
): SyncState {
  const { rawTime, adjustedLyricsTime } = params
  let activeLineIndex = lines.findIndex(
    (line) => rawTime >= line.startTime && rawTime < line.endTime
  )

  if (activeLineIndex < 0 && lines.length > 0) {
    for (let i = lines.length - 1; i >= 0; i--) {
      if (lines[i].endTime <= rawTime) {
        if (rawTime - lines[i].endTime < PREV_LINE_LINGER_S) {
          activeLineIndex = i
          break
        }
        if (
          i + 1 < lines.length &&
          lines[i + 1].startTime - rawTime < NEXT_LINE_LOOKAHEAD_S
        ) {
          activeLineIndex = i + 1
          break
        }
        break
      }
    }
    if (
      activeLineIndex < 0 &&
      lines.length > 0 &&
      lines[0].startTime - rawTime < NEXT_LINE_LOOKAHEAD_S
    ) {
      activeLineIndex = 0
    }
  }

  let activeWordIndex = -1
  if (activeLineIndex >= 0) {
    const line = lines[activeLineIndex]
    if (line.words.length > 0) {
      activeWordIndex = line.words.findIndex(
        (w) => adjustedLyricsTime >= w.start && adjustedLyricsTime < w.end
      )
    }
  }

  // Find active note time (the start_time of the note bucket that currentTime falls within)
  let activeNoteTime = -1
  if (activeLineIndex >= 0) {
    const note = lines[activeLineIndex].notes.find(
      (n) => rawTime >= n.start_time && rawTime < n.end_time
    )
    if (note) activeNoteTime = note.start_time
  }

  return { activeLineIndex, activeWordIndex, activeNoteTime }
}

function sameState(a: SyncState, b: SyncState): boolean {
  return (
    a.activeLineIndex === b.activeLineIndex &&
    a.activeWordIndex === b.activeWordIndex &&
    a.activeNoteTime === b.activeNoteTime
  )
}

export function useTabsSheetSync(lines: TabsSheetLine[]) {
  const linesRef = useRef(lines)

  // Keep the latest lines in a ref for the store subscription callback.
  // Update in a layout effect to avoid accessing refs during render.
  useLayoutEffect(() => {
    linesRef.current = lines
  }, [lines])

  const offsetRef = useRef(usePlayerPrefsStore.getState().lyricsOffsetMs)

  const getTimes = useCallback(() => {
    const rawTime = usePlaybackStore.getState().currentTime
    // Positive offset = delay lyrics (subtract from time so lyrics lag behind).
    const adjustedLyricsTime = rawTime - offsetRef.current / 1000
    return { rawTime, adjustedLyricsTime }
  }, [])

  const [state, setState] = useState<SyncState>(() =>
    computeSync(lines, getTimes())
  )

  // Recompute helper — called from both playback and prefs subscriptions.
  const recompute = useCallback(() => {
    const next = computeSync(linesRef.current, getTimes())
    setState((prev) => (sameState(prev, next) ? prev : next))
  }, [getTimes])

  useEffect(() => {
    // Recompute when lines change
    recompute()

    // Recompute on every currentTime update (playback ticking).
    const unsubPlayback = usePlaybackStore.subscribe(recompute)

    // Also recompute when the lyrics offset changes so the user sees
    // immediate feedback (even when paused).
    const unsubPrefs = usePlayerPrefsStore.subscribe((s) => {
      offsetRef.current = s.lyricsOffsetMs
      recompute()
    })

    return () => {
      unsubPlayback()
      unsubPrefs()
    }
  }, [lines, recompute])

  return state
}

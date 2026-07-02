import { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react'
import { usePlaybackStore } from '@/stores/playback.store'
import { usePlayerPrefsStore } from '@/stores/player-prefs.store'
import { createScanCursor, scanForwardMostRecentStarted, type ScanCursor } from '../lib/cursor-scan'
import type { TabsSheetLine } from '../lib/merge-tabs-lyrics'

/** Max gap (seconds) to keep the previous line highlighted after it ends. */
const PREV_LINE_LINGER_S = 0.8
/** Max gap (seconds) to look ahead and highlight the upcoming line. */
const NEXT_LINE_LOOKAHEAD_S = 0.5

interface SyncState {
  activeLineIndex: number
  activeWordIndex: number
  activeNoteTime: number
}

interface TimedLine {
  startTime: number
  endTime: number
}

/**
 * Active line index, including the linger/lookahead grace windows around
 * gaps between lines. Built on `scanForwardMostRecentStarted` — the
 * candidate it returns is either the containing line (if `time` falls
 * inside it) or the most recently ended line (since a line whose start is
 * <= time but whose end is also <= time is, by definition, not the
 * containing line), which is exactly what the linger/lookahead checks need.
 */
export function computeActiveLineIndex(
  lines: TimedLine[],
  rawTime: number,
  cursor: ScanCursor,
): number {
  const cand = scanForwardMostRecentStarted(lines.length, rawTime, (i) => lines[i].startTime, cursor)

  if (cand >= 0 && rawTime < lines[cand].endTime) {
    return cand
  }

  if (cand >= 0) {
    if (rawTime - lines[cand].endTime < PREV_LINE_LINGER_S) {
      return cand
    }
    if (cand + 1 < lines.length && lines[cand + 1].startTime - rawTime < NEXT_LINE_LOOKAHEAD_S) {
      return cand + 1
    }
    return -1
  }

  if (lines.length > 0 && lines[0].startTime - rawTime < NEXT_LINE_LOOKAHEAD_S) {
    return 0
  }
  return -1
}

function computeSync(
  lines: TabsSheetLine[],
  params: { rawTime: number; adjustedLyricsTime: number },
  cursor: ScanCursor,
): SyncState {
  const { rawTime, adjustedLyricsTime } = params
  const activeLineIndex = computeActiveLineIndex(lines, rawTime, cursor)

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

const EMPTY_STATE: SyncState = { activeLineIndex: -1, activeWordIndex: -1, activeNoteTime: -1 }

interface UseTabsSheetSyncOptions {
  /**
   * When false, skip all per-frame scanning and store subscriptions — used
   * when the tabs highlight is turned off, so a hidden sheet costs nothing
   * on every playback tick.
   */
  enabled?: boolean
}

export function useTabsSheetSync(lines: TabsSheetLine[], options?: UseTabsSheetSyncOptions) {
  const enabled = options?.enabled ?? true

  const linesRef = useRef(lines)
  // A fresh cursor whenever `lines` changes reference — the previous
  // cursor's position is meaningless for different data.
  const cursorRef = useRef(createScanCursor())

  // Keep the latest lines in a ref for the store subscription callback.
  // Update in a layout effect to avoid accessing refs during render.
  useLayoutEffect(() => {
    if (linesRef.current !== lines) {
      cursorRef.current = createScanCursor()
    }
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
    enabled ? computeSync(lines, getTimes(), cursorRef.current) : EMPTY_STATE
  )

  // Recompute helper — called from both playback and prefs subscriptions.
  const recompute = useCallback(() => {
    const next = computeSync(linesRef.current, getTimes(), cursorRef.current)
    setState((prev) => (sameState(prev, next) ? prev : next))
  }, [getTimes])

  useEffect(() => {
    if (!enabled) return

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
  }, [lines, recompute, enabled])

  return enabled ? state : EMPTY_STATE
}

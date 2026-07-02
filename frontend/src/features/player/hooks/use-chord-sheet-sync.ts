import { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react'
import { usePlaybackStore } from '@/stores/playback.store'
import { usePlayerPrefsStore } from '@/stores/player-prefs.store'
import { createScanCursor, scanForwardActiveTimedIndex, scanForwardMostRecentStarted, type ScanCursor } from '../lib/cursor-scan'
import type { ChordSheetLine } from '../lib/merge-chords-lyrics'

interface SyncState {
  activeLineIndex: number
  activeWordIndex: number
  activeChordLineIndex: number
  activeChordIndex: number
}

interface FlatChord {
  lineIndex: number
  chordIndex: number
  startTime: number
}

/**
 * Flatten every line's chords into a single time-ordered list so the active
 * chord can be found with one forward-cursor scan instead of a per-frame
 * loop over every line. Only recomputed when `lines` changes, never per
 * playback tick.
 */
function flattenChordsByStartTime(lines: ChordSheetLine[]): FlatChord[] {
  const flat: FlatChord[] = []
  for (let li = 0; li < lines.length; li++) {
    const chords = lines[li].chords
    for (let ci = 0; ci < chords.length; ci++) {
      flat.push({ lineIndex: li, chordIndex: ci, startTime: chords[ci].start_time })
    }
  }
  // Lines and each line's own chords are already time-ordered, but a chord
  // rendered on an earlier instrumental line can start after a chord on a
  // later lyric line — sort defensively so the scan cursor's monotonic
  // assumption holds.
  return flat.sort((a, b) => a.startTime - b.startTime)
}

function computeSync(
  lines: ChordSheetLine[],
  flatChords: FlatChord[],
  adjustedLyricsTime: number,
  lineCursor: ScanCursor,
  chordCursor: ScanCursor,
): SyncState {
  // Most recently started line — monotonic in time, so the highlight can
  // never jump backward even if stored timestamps overlap. Gaps keep the
  // previous line active until the next one starts. Use the same lyrics-adjusted
  // timebase as word selection so the active line and active word do not fight
  // each other when the user tweaks the lyrics offset.
  const activeLineIndex = scanForwardActiveTimedIndex(
    lines.length,
    adjustedLyricsTime,
    (i) => lines[i].startTime,
    (i) => lines[i].endTime,
    lineCursor,
  )

  // Active word
  let activeWordIndex = -1
  if (activeLineIndex >= 0) {
    const line = lines[activeLineIndex]
    if (line.words.length > 0) {
      activeWordIndex = line.words.findIndex(
        (w) => adjustedLyricsTime >= w.start && adjustedLyricsTime < w.end
      )

      // If no word spans currentTime, find the most recently ended word
      // rather than jumping to the last word in the line. This keeps the
      // highlight "dragging" on the word that just finished.
      if (activeWordIndex < 0) {
        let bestIdx = -1
        for (let j = line.words.length - 1; j >= 0; j--) {
          if (adjustedLyricsTime >= line.words[j].end) {
            bestIdx = j
            break
          }
        }
        activeWordIndex = bestIdx >= 0 ? bestIdx : 0
      }
    }
  }

  // Active chord: find the latest started rendered chord globally, not only on
  // the active lyric line. Chords near lyric boundaries can render on the
  // previous/next line; tying chord highlight to the lyric line makes those
  // chords get skipped during playback.
  const activeFlatIndex = scanForwardMostRecentStarted(
    flatChords.length,
    adjustedLyricsTime,
    (i) => flatChords[i].startTime,
    chordCursor,
  )
  const activeChordLineIndex = activeFlatIndex >= 0 ? flatChords[activeFlatIndex].lineIndex : -1
  const activeChordIndex = activeFlatIndex >= 0 ? flatChords[activeFlatIndex].chordIndex : -1

  return { activeLineIndex, activeWordIndex, activeChordLineIndex, activeChordIndex }
}

function sameState(a: SyncState, b: SyncState): boolean {
  return (
    a.activeLineIndex === b.activeLineIndex &&
    a.activeWordIndex === b.activeWordIndex &&
    a.activeChordLineIndex === b.activeChordLineIndex &&
    a.activeChordIndex === b.activeChordIndex
  )
}

const EMPTY_STATE: SyncState = {
  activeLineIndex: -1,
  activeWordIndex: -1,
  activeChordLineIndex: -1,
  activeChordIndex: -1,
}

interface UseChordSheetSyncOptions {
  /**
   * When false, skip all per-frame scanning and store subscriptions — used
   * when the chord/lyrics highlight is turned off, so a hidden sheet costs
   * nothing on every playback tick.
   */
  enabled?: boolean
}

export function useChordSheetSync(lines: ChordSheetLine[], options?: UseChordSheetSyncOptions) {
  const enabled = options?.enabled ?? true

  const linesRef = useRef(lines)
  const flatChordsRef = useRef(flattenChordsByStartTime(lines))
  // Fresh cursors whenever `lines` changes reference — the previous cursor's
  // position is meaningless for different data.
  const lineCursorRef = useRef(createScanCursor())
  const chordCursorRef = useRef(createScanCursor())

  // Keep the latest lines in a ref for the store subscription callback.
  // Update in a layout effect to avoid accessing refs during render.
  useLayoutEffect(() => {
    if (linesRef.current !== lines) {
      flatChordsRef.current = flattenChordsByStartTime(lines)
      lineCursorRef.current = createScanCursor()
      chordCursorRef.current = createScanCursor()
    }
    linesRef.current = lines
  }, [lines])

  const offsetRef = useRef(usePlayerPrefsStore.getState().lyricsOffsetMs)

  const getAdjustedLyricsTime = useCallback(() => {
    // Positive offset = delay lyrics (subtract from time so lyrics lag behind).
    return usePlaybackStore.getState().currentTime - offsetRef.current / 1000
  }, [])

  const [state, setState] = useState<SyncState>(() =>
    enabled
      ? computeSync(lines, flatChordsRef.current, getAdjustedLyricsTime(), lineCursorRef.current, chordCursorRef.current)
      : EMPTY_STATE
  )

  // Recompute helper — called from both playback and prefs subscriptions.
  const recompute = useCallback(() => {
    const next = computeSync(
      linesRef.current,
      flatChordsRef.current,
      getAdjustedLyricsTime(),
      lineCursorRef.current,
      chordCursorRef.current,
    )
    setState((prev) => (sameState(prev, next) ? prev : next))
  }, [getAdjustedLyricsTime])

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

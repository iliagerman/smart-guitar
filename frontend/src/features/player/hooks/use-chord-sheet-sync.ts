import { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react'
import { usePlaybackStore } from '@/stores/playback.store'
import { usePlayerPrefsStore } from '@/stores/player-prefs.store'
import type { ChordSheetLine } from '../lib/merge-chords-lyrics'

interface SyncState {
  activeLineIndex: number
  activeWordIndex: number
  activeChordIndex: number
}

function computeSync(
  lines: ChordSheetLine[],
  params: { rawTime: number; adjustedLyricsTime: number }
): SyncState {
  const { rawTime, adjustedLyricsTime } = params
  // Active line is driven strictly by line time bounds (lyrics timestamps).
  // If currentTime falls into a true gap between two lyric lines, keep the
  // previous line active until the next one starts (no arbitrary linger).
  // IMPORTANT: line selection is based on the *audio timebase* (rawTime) so
  // chord highlighting/scrolling stays aligned even when the user tweaks the
  // lyrics offset.
  let activeLineIndex = lines.findIndex(
    (line) => rawTime >= line.startTime && rawTime < line.endTime
  )

  if (activeLineIndex < 0 && lines.length > 1) {
    for (let i = 0; i < lines.length - 1; i++) {
      const a = lines[i]
      const b = lines[i + 1]
      if (rawTime >= a.endTime && rawTime < b.startTime) {
        activeLineIndex = i
        break
      }
    }
  }

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

  // Active chord
  let activeChordIndex = -1
  if (activeLineIndex >= 0) {
    activeChordIndex = lines[activeLineIndex].chords.findIndex(
      (c) => rawTime >= c.start_time && rawTime < c.end_time
    )
  }

  return { activeLineIndex, activeWordIndex, activeChordIndex }
}

function sameState(a: SyncState, b: SyncState): boolean {
  return (
    a.activeLineIndex === b.activeLineIndex &&
    a.activeWordIndex === b.activeWordIndex &&
    a.activeChordIndex === b.activeChordIndex
  )
}

export function useChordSheetSync(lines: ChordSheetLine[]) {
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

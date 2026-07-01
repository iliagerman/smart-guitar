import { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react'
import { usePlaybackStore } from '@/stores/playback.store'
import { usePlayerPrefsStore } from '@/stores/player-prefs.store'
import { findActiveTimedIndex } from '../lib/active-timed-index'
import { findActiveChordIndex, type ChordSheetLine } from '../lib/merge-chords-lyrics'

interface SyncState {
  activeLineIndex: number
  activeWordIndex: number
  activeChordLineIndex: number
  activeChordIndex: number
}

function computeSync(
  lines: ChordSheetLine[],
  adjustedLyricsTime: number,
): SyncState {
  // Most recently started line — monotonic in time, so the highlight can
  // never jump backward even if stored timestamps overlap. Gaps keep the
  // previous line active until the next one starts. Use the same lyrics-adjusted
  // timebase as word selection so the active line and active word do not fight
  // each other when the user tweaks the lyrics offset.
  const activeLineIndex = findActiveTimedIndex(
    lines.length,
    adjustedLyricsTime,
    (i) => lines[i].startTime,
    (i) => lines[i].endTime,
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
  let activeChordLineIndex = -1
  let activeChordIndex = -1
  let activeChordStart = -Infinity
  for (let i = 0; i < lines.length; i++) {
    const chordIndex = findActiveChordIndex(lines[i].chords, adjustedLyricsTime)
    if (chordIndex < 0) continue
    const chordStart = lines[i].chords[chordIndex].start_time
    if (chordStart > activeChordStart) {
      activeChordStart = chordStart
      activeChordLineIndex = i
      activeChordIndex = chordIndex
    }
  }

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

export function useChordSheetSync(lines: ChordSheetLine[]) {
  const linesRef = useRef(lines)

  // Keep the latest lines in a ref for the store subscription callback.
  // Update in a layout effect to avoid accessing refs during render.
  useLayoutEffect(() => {
    linesRef.current = lines
  }, [lines])

  const offsetRef = useRef(usePlayerPrefsStore.getState().lyricsOffsetMs)

  const getAdjustedLyricsTime = useCallback(() => {
    // Positive offset = delay lyrics (subtract from time so lyrics lag behind).
    return usePlaybackStore.getState().currentTime - offsetRef.current / 1000
  }, [])

  const [state, setState] = useState<SyncState>(() =>
    computeSync(lines, getAdjustedLyricsTime())
  )

  // Recompute helper — called from both playback and prefs subscriptions.
  const recompute = useCallback(() => {
    const next = computeSync(linesRef.current, getAdjustedLyricsTime())
    setState((prev) => (sameState(prev, next) ? prev : next))
  }, [getAdjustedLyricsTime])

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

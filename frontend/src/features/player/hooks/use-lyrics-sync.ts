import { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react'
import { usePlaybackStore } from '@/stores/playback.store'
import { usePlayerPrefsStore } from '@/stores/player-prefs.store'
import type { LyricsSegment } from '@/types/song'

interface SyncState {
  activeSegmentIndex: number
  activeWordIndex: number
}

function computeSync(segments: LyricsSegment[], currentTime: number): SyncState {
  let activeSegmentIndex = segments.findIndex(
    (s) => currentTime >= s.start && currentTime < s.end
  )

  // If currentTime falls in a true gap between segments, keep the previous
  // segment active until the next one starts. This avoids the UI going blank
  // while still keeping segment boundaries strictly timestamp-driven.
  if (activeSegmentIndex < 0 && segments.length > 1) {
    for (let i = 0; i < segments.length - 1; i++) {
      const a = segments[i]
      const b = segments[i + 1]
      if (currentTime >= a.end && currentTime < b.start) {
        activeSegmentIndex = i
        break
      }
    }
  }

  let activeWordIndex = -1
  if (activeSegmentIndex >= 0) {
    activeWordIndex = segments[activeSegmentIndex].words.findIndex(
      (w) => currentTime >= w.start && currentTime < w.end
    )

    if (activeWordIndex < 0) {
      const words = segments[activeSegmentIndex].words
      // Find the most recently ended word rather than jumping to the last
      // word in the segment. This keeps the highlight "dragging" on the
      // word that just finished speaking.
      let bestIdx = -1
      for (let j = words.length - 1; j >= 0; j--) {
        if (currentTime >= words[j].end) {
          bestIdx = j
          break
        }
      }
      // If currentTime is before all words (segment-start gap), show first word.
      activeWordIndex = bestIdx >= 0 ? bestIdx : 0
    }
  }

  return { activeSegmentIndex, activeWordIndex }
}

function sameState(a: SyncState, b: SyncState): boolean {
  return (
    a.activeSegmentIndex === b.activeSegmentIndex &&
    a.activeWordIndex === b.activeWordIndex
  )
}

export function useLyricsSync(segments: LyricsSegment[]) {
  const segmentsRef = useRef(segments)

  // Keep the latest segments in a ref for the store subscription callback.
  // Update in a layout effect to avoid accessing refs during render.
  useLayoutEffect(() => {
    segmentsRef.current = segments
  }, [segments])

  const offsetRef = useRef(usePlayerPrefsStore.getState().lyricsOffsetMs)

  const getAdjustedTime = useCallback(() => {
    // Positive offset = delay lyrics (subtract from time so lyrics lag behind).
    return usePlaybackStore.getState().currentTime - offsetRef.current / 1000
  }, [])

  const [state, setState] = useState<SyncState>(() =>
    computeSync(segments, getAdjustedTime())
  )

  // Recompute helper — called from both playback and prefs subscriptions.
  const recompute = useCallback(() => {
    const next = computeSync(segmentsRef.current, getAdjustedTime())
    setState((prev) => {
      if (sameState(prev, next)) return prev

      // Debug logging — enabled via localStorage (toggle with Ctrl+Shift+D)
      if (
        typeof window !== 'undefined' &&
        localStorage.getItem('lyrics-debug-enabled') === 'true'
      ) {
        const segs = segmentsRef.current
        const word =
          next.activeSegmentIndex >= 0
            ? segs[next.activeSegmentIndex]?.words[next.activeWordIndex]
            : null
        console.debug('[lyrics-sync]', {
          rawTime: usePlaybackStore.getState().currentTime.toFixed(3),
          adjustedTime: getAdjustedTime().toFixed(3),
          offset: offsetRef.current,
          segIdx: next.activeSegmentIndex,
          wordIdx: next.activeWordIndex,
          word: word
            ? `"${word.word}" [${word.start.toFixed(3)}-${word.end.toFixed(3)}]`
            : null,
        })
      }

      return next
    })
  }, [getAdjustedTime])

  useEffect(() => {
    // Recompute when segments change
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
  }, [segments, recompute])

  return state
}

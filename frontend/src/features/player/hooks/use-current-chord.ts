import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { usePlaybackStore } from '@/stores/playback.store'
import type { ChordEntry } from '@/types/song'
import { createScanCursor, scanForwardMostRecentStarted, type ScanCursor } from '../lib/cursor-scan'

/** Drops 'N' (no-chord) entries, which are never eligible to be displayed. */
export function filterRealChords(chords: ChordEntry[]): ChordEntry[] {
  return chords.filter((c) => c.chord !== 'N')
}

/**
 * The active chord is the most recently started entry in `realChords` (already
 * filtered to exclude 'N'). This matches the original `findDisplayChord`: a chord
 * containing `currentTime` is, by definition, the most recently started one, and
 * when no chord contains `currentTime` (an unlabeled gap), the most recently
 * started chord is the correct fallback regardless of whether it has "ended".
 */
export function findActiveChordEntry(
  realChords: ChordEntry[],
  currentTime: number,
  cursor: ScanCursor
): ChordEntry | null {
  const idx = scanForwardMostRecentStarted(realChords.length, currentTime, (i) => realChords[i].start_time, cursor)
  return idx >= 0 ? realChords[idx] : null
}

/**
 * Tracks the chord that should currently be displayed, without re-running a
 * linear scan on every playback tick. Subscribes directly to the playback
 * store (rather than `usePlaybackStore(selector)`) so the cursor-based scan
 * can persist across ticks, and only triggers a re-render when the displayed
 * chord entry actually changes.
 */
export function useCurrentChord(chords: ChordEntry[]): ChordEntry | null {
  const realChords = useMemo(() => filterRealChords(chords), [chords])

  const realChordsRef = useRef(realChords)
  // A fresh cursor whenever `realChords` changes reference — the previous
  // cursor's position is meaningless for different data.
  const cursorRef = useRef(createScanCursor())

  useLayoutEffect(() => {
    if (realChordsRef.current !== realChords) {
      cursorRef.current = createScanCursor()
    }
    realChordsRef.current = realChords
  }, [realChords])

  // Ref reads are deferred to `recompute`, which only ever runs inside an
  // effect/subscription callback — never synchronously during render.
  const [chord, setChord] = useState<ChordEntry | null>(null)

  const recompute = useCallback(() => {
    const currentTime = usePlaybackStore.getState().currentTime
    const next = findActiveChordEntry(realChordsRef.current, currentTime, cursorRef.current)
    setChord((prev) => (prev === next ? prev : next))
  }, [])

  // Layout effect (not a plain effect) so the initial chord is computed and
  // applied before paint, avoiding a one-frame flash of "no chord".
  useLayoutEffect(() => {
    recompute()
    return usePlaybackStore.subscribe(recompute)
  }, [realChords, recompute])

  return chord
}

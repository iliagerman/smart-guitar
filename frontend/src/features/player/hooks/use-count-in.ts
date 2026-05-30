import { useCallback, useEffect, useRef, useState } from 'react'

import { playTick } from '../lib/count-in-audio'

const DEFAULT_COUNTS = 3
const DEFAULT_INTERVAL_MS = 1000

interface UseCountInOptions {
  /** How many beats to count (default 3 → "3, 2, 1"). */
  counts?: number
  /** Milliseconds between beats (default 1000). */
  intervalMs?: number
  /** Play an audible tick on each beat plus an accent on the downbeat. */
  withTicks?: boolean
}

interface UseCountInResult {
  /** Current number shown (counts → 1), or 0 when not counting. */
  count: number
  isCounting: boolean
  /** Begin the count-in; `onComplete` fires on the downbeat (when playback should start). */
  start: (onComplete: () => void) => void
  /** Abort an in-progress count-in; `onComplete` will not fire. */
  cancel: () => void
}

/**
 * Drives a "3, 2, 1" count-in before playback. Each beat advances the visible number
 * and (optionally) plays a tick; on the final downbeat the count clears and `onComplete`
 * runs. Pending timers are cleared on cancel and on unmount so a finished countdown never
 * starts playback after the user has bailed or navigated away.
 */
export function useCountIn({
  counts = DEFAULT_COUNTS,
  intervalMs = DEFAULT_INTERVAL_MS,
  withTicks = true,
}: UseCountInOptions = {}): UseCountInResult {
  const [count, setCount] = useState(0)
  const timersRef = useRef<number[]>([])
  const onCompleteRef = useRef<(() => void) | null>(null)

  const clearTimers = useCallback(() => {
    for (const id of timersRef.current) window.clearTimeout(id)
    timersRef.current = []
  }, [])

  const cancel = useCallback(() => {
    clearTimers()
    onCompleteRef.current = null
    setCount(0)
  }, [clearTimers])

  const start = useCallback(
    (onComplete: () => void) => {
      clearTimers()
      onCompleteRef.current = onComplete
      setCount(counts)
      if (withTicks) playTick()

      for (let step = 1; step < counts; step++) {
        timersRef.current.push(
          window.setTimeout(() => {
            setCount(counts - step)
            if (withTicks) playTick()
          }, step * intervalMs),
        )
      }

      timersRef.current.push(
        window.setTimeout(() => {
          timersRef.current = []
          setCount(0)
          if (withTicks) playTick({ accent: true })
          const done = onCompleteRef.current
          onCompleteRef.current = null
          done?.()
        }, counts * intervalMs),
      )
    },
    [clearTimers, counts, intervalMs, withTicks],
  )

  // Clear any pending countdown when the owning component unmounts (e.g. navigating away).
  useEffect(() => cancel, [cancel])

  return { count, isCounting: count > 0, start, cancel }
}

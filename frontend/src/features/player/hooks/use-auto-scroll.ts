import { useEffect, useRef, type RefObject } from 'react'
import { usePlaybackStore } from '@/stores/playback.store'
import { usePlayerPrefsStore } from '@/stores/player-prefs.store'

/** After a manual scroll, pause auto-scroll for this duration. */
const MANUAL_SCROLL_PAUSE_MS = 3_000
/** Ignore frame deltas larger than this to avoid jumps after tab refocus. */
const MAX_DT_S = 0.5

/**
 * Smooth rAF-based auto-scroll for a scrollable container.
 * Advances `scrollTop` at `autoScrollSpeed` px/sec while audio is playing.
 * Pauses for 3 s when the user scrolls manually (wheel / touch / scrollbar).
 */
export function useAutoScroll(
  scrollRef: RefObject<HTMLDivElement | null>,
  enabled: boolean,
): void {
  const rafRef = useRef(0)
  const lastFrameRef = useRef(0)
  const pauseUntilRef = useRef(0)
  const programmaticRef = useRef(false)
  const isPlaying = usePlaybackStore((s) => s.isPlaying)

  useEffect(() => {
    // Gate the rAF loop on playback: auto-scroll only advances while playing,
    // so keeping a 60fps loop alive while paused just spins the CPU (and heats
    // the phone) for nothing. The effect re-runs when playback flips.
    if (!enabled || !isPlaying) return

    const el = scrollRef.current
    if (!el) return

    // --- manual-scroll detection ---
    const markManual = () => {
      pauseUntilRef.current = performance.now() + MANUAL_SCROLL_PAUSE_MS
    }

    const onWheel = () => markManual()
    const onTouchStart = () => markManual()
    const onScroll = () => {
      if (!programmaticRef.current) markManual()
      programmaticRef.current = false
    }

    el.addEventListener('wheel', onWheel, { passive: true })
    el.addEventListener('touchstart', onTouchStart, { passive: true })
    el.addEventListener('scroll', onScroll, { passive: true })

    // --- animation loop (only alive while playing; see gate above) ---
    const tick = (now: number) => {
      const { autoScrollSpeed } = usePlayerPrefsStore.getState()

      if (now > pauseUntilRef.current) {
        const dt =
          lastFrameRef.current > 0
            ? (now - lastFrameRef.current) / 1_000
            : 0

        if (dt > 0 && dt < MAX_DT_S) {
          programmaticRef.current = true
          el.scrollTop += autoScrollSpeed * dt
        }
      }

      lastFrameRef.current = now
      rafRef.current = requestAnimationFrame(tick)
    }

    lastFrameRef.current = 0
    rafRef.current = requestAnimationFrame(tick)

    return () => {
      cancelAnimationFrame(rafRef.current)
      el.removeEventListener('wheel', onWheel)
      el.removeEventListener('touchstart', onTouchStart)
      el.removeEventListener('scroll', onScroll)
    }
  }, [enabled, isPlaying, scrollRef])
}

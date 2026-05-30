import { useEffect } from 'react'
import { createPortal } from 'react-dom'

interface CountInOverlayProps {
  /** Current count to display (1+). When 0 or less, nothing renders. */
  count: number
  /** Called when the user dismisses the count-in (tap, Enter/Space, or Escape). */
  onCancel: () => void
}

/**
 * Full-screen "get ready" overlay shown during the playback count-in. Renders the
 * current number with a pop animation on each beat. Tapping anywhere (or pressing
 * Escape) cancels the count-in so playback never starts.
 */
export function CountInOverlay({ count, onCancel }: CountInOverlayProps) {
  useEffect(() => {
    if (count <= 0) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [count, onCancel])

  if (count <= 0) return null

  return createPortal(
    <button
      type="button"
      onClick={onCancel}
      aria-label="Cancel count-in"
      className="fixed inset-0 z-[10000] flex flex-col items-center justify-center gap-6 bg-charcoal-950/80 backdrop-blur-sm focus:outline-none"
      data-testid="count-in-overlay"
    >
      <span
        // Re-mounting on each value replays the pop animation.
        key={count}
        aria-hidden="true"
        className="animate-count-in-pop font-mono text-[7rem] md:text-[11rem] font-bold leading-none text-flame-400 drop-shadow-[0_0_30px_rgba(250,204,21,0.45)]"
        data-testid="count-in-number"
      >
        {count}
      </span>
      <span className="text-sm font-medium text-smoke-300">Get ready… tap to cancel</span>
    </button>,
    document.body,
  )
}

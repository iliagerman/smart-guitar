import { useEffect } from 'react'
import { createPortal } from 'react-dom'

interface CountInOverlayProps {
  /** Current count to display (1+). When 0 or less, nothing renders. */
  count: number
  /** The fret the capo goes on for this sheet, or 0 without a capo. */
  capoFret?: number
  /** Tap (or Enter/Space): skip the rest of the count and start the song now. */
  onSkip: () => void
  /** Escape: stop, and don't start the song. */
  onCancel: () => void
}

/**
 * Full-screen "get ready" overlay shown during the playback count-in, with a
 * reminder when the sheet is played with a capo. Tapping anywhere starts the
 * song straight away; only Escape calls it off.
 */
export function CountInOverlay({ count, capoFret = 0, onSkip, onCancel }: CountInOverlayProps) {
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
      onClick={onSkip}
      aria-label="Start the song now"
      className="fixed inset-0 z-[10000] flex flex-col items-center justify-center gap-6 bg-charcoal-950/80 backdrop-blur-sm focus:outline-none"
      data-testid="count-in-overlay"
    >
      {capoFret > 0 && (
        <span
          className="flex items-center gap-2 rounded-full bg-gradient-to-br from-fire-400 to-fire-600 px-5 py-2 font-display text-2xl tracking-wide text-white shadow-[0_12px_36px_rgba(249,115,22,0.5)] md:text-3xl"
          data-testid="count-in-capo"
        >
          Capo on fret {capoFret}
        </span>
      )}
      <span
        // Re-mounting on each value replays the pop animation.
        key={count}
        aria-hidden="true"
        className="animate-count-in-pop font-mono text-[7rem] md:text-[11rem] font-bold leading-none text-flame-400 drop-shadow-[0_0_30px_rgba(250,204,21,0.45)]"
        data-testid="count-in-number"
      >
        {count}
      </span>
      <span className="text-sm font-medium text-smoke-300">Get ready… tap to start now</span>
    </button>,
    document.body,
  )
}

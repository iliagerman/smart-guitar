/**
 * Scroll an element into the vertical center of a specific container,
 * without affecting any ancestor scroll positions.
 *
 * Unlike `element.scrollIntoView()`, this only adjusts `container.scrollTop`
 * so nested flex layouts won't get unexpectedly scrolled.
 */
export function scrollToCenter(
  container: HTMLElement,
  target: HTMLElement,
): void {
  const containerRect = container.getBoundingClientRect()
  const targetRect = target.getBoundingClientRect()
  const delta =
    targetRect.top + targetRect.height / 2 -
    (containerRect.top + containerRect.height / 2)
  container.scrollTop += delta
}

/** Where a followed row settles, as a fraction of the container's height from its top. */
const READING_POINT = 0.3
/** The row may drift between these fractions of the height before the sheet moves. */
const BAND_TOP = 0.1
const BAND_BOTTOM = 0.7
/** Moves smaller than this aren't worth a scroll. */
const MIN_MOVE_PX = 4

/**
 * The scrollTop that brings `target` back to the reading point, or null while
 * it is still comfortably inside the reading band. Measured in content
 * coordinates, so asking again mid-glide returns the same answer.
 */
export function readingScrollTop(container: HTMLElement, target: HTMLElement): number | null {
  const box = container.getBoundingClientRect()
  const rect = target.getBoundingClientRect()
  const top = rect.top - box.top
  if (top >= box.height * BAND_TOP && rect.bottom - box.top <= box.height * BAND_BOTTOM) return null

  const maxScroll = container.scrollHeight - container.clientHeight
  const next = Math.round(Math.min(maxScroll, Math.max(0, container.scrollTop + top - box.height * READING_POINT)))
  return Math.abs(next - container.scrollTop) < MIN_MOVE_PX ? null : next
}

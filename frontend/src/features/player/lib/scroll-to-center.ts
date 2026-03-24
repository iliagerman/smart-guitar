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

/**
 * Check whether a target element is fully visible within a scroll container.
 * An optional margin (px) triggers the scroll slightly before the element
 * reaches the exact edge, so users don't feel like they're "chasing" content.
 */
export function isElementVisible(
  container: HTMLElement,
  target: HTMLElement,
  margin = 40,
): boolean {
  const cRect = container.getBoundingClientRect()
  const tRect = target.getBoundingClientRect()
  return tRect.top >= cRect.top - margin && tRect.bottom <= cRect.bottom + margin
}

/**
 * Scroll just enough to bring the target element into view within the
 * container, plus a small padding so it doesn't sit right at the edge.
 * Uses native smooth scrolling for a gentle, non-jarring transition.
 */
export function scrollIntoContainerView(
  container: HTMLElement,
  target: HTMLElement,
  padding = 60,
): void {
  const cRect = container.getBoundingClientRect()
  const tRect = target.getBoundingClientRect()

  let delta = 0
  if (tRect.bottom > cRect.bottom - padding) {
    // Target is below the visible area — scroll down just enough
    delta = tRect.bottom - (cRect.bottom - padding)
  } else if (tRect.top < cRect.top + padding) {
    // Target is above the visible area — scroll up just enough
    delta = tRect.top - (cRect.top + padding)
  }

  if (delta !== 0) {
    container.scrollTo({
      top: container.scrollTop + delta,
      behavior: 'smooth',
    })
  }
}

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

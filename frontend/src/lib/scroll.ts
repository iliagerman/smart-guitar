/**
 * Walk up from an element to the nearest scrollable ancestor (the element whose
 * own `overflow-y` is `auto` or `scroll`). Returns `null` if there isn't one.
 *
 * Useful when a component lives inside a scroll container it doesn't own (e.g. a
 * paginated list rendered inside an app-shell scroll area) and needs to reset
 * the scroll position.
 */
export function getScrollableParent(element: HTMLElement | null): HTMLElement | null {
  let node = element?.parentElement ?? null
  while (node) {
    const { overflowY } = getComputedStyle(node)
    if (overflowY === 'auto' || overflowY === 'scroll') return node
    node = node.parentElement
  }
  return null
}

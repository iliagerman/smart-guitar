import { useLayoutEffect, useRef, useState, type RefObject } from 'react'

/**
 * Keeps the step being played in view in a pattern strip too wide for its box,
 * scrolling forward as an endless loop.
 *
 * Returns how many copies of the pattern to render: 3 when one copy overflows
 * the strip (the middle copy is the real one), otherwise 1. Each step scrolls
 * its middle-copy item to the centre; when the pattern starts over, the strip
 * first jumps back one copy (the copies look the same), so it keeps moving
 * forward instead of rewinding.
 *
 * @param listRef the scrolling list, one child per step per copy
 * @param steps steps in one copy of the pattern
 * @param current the step being played, or -1 when nothing plays
 */
export function useLoopScroll(listRef: RefObject<HTMLElement | null>, steps: number, current: number): number {
  const [overflows, setOverflows] = useState(false)
  const copies = overflows ? 3 : 1
  const previous = useRef(-1)

  useLayoutEffect(() => {
    const list = listRef.current
    if (!list || steps === 0) return
    const measure = () => {
      const rendered = list.children.length / steps
      setOverflows(list.scrollWidth / rendered > list.clientWidth + 1)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(list)
    return () => observer.disconnect()
  }, [listRef, steps, copies])

  useLayoutEffect(() => {
    const list = listRef.current
    if (!list || copies === 1 || list.children.length !== steps * copies) return
    const items = list.children as HTMLCollectionOf<HTMLElement>
    if (current < 0) {
      previous.current = -1
      list.scrollTo({ left: items[steps].offsetLeft })
      return
    }
    if (current < previous.current) list.scrollLeft -= items[steps].offsetLeft - items[0].offsetLeft
    previous.current = current
    const target = items[steps + current]
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    list.scrollTo({
      left: target.offsetLeft - (list.clientWidth - target.offsetWidth) / 2,
      behavior: reduceMotion ? 'auto' : 'smooth',
    })
  }, [listRef, steps, copies, current])

  return copies
}

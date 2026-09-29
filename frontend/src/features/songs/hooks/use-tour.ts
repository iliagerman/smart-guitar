import { useCallback, useEffect, useRef, useState } from 'react'

const THRESHOLDS = [0, 0.15, 0.3, 0.45, 0.6, 0.75, 0.9, 1]

/**
 * Tracks which tour stop fills most of the screen. Sections register with
 * `observe(id)` as a ref callback; the stop with the largest visible share wins.
 *
 * @returns the active stop id and a ref-callback factory for each stop.
 */
export function useActiveStop(initial: string) {
  const [active, setActive] = useState(initial)
  const ratios = useRef(new Map<string, number>())
  const observerRef = useRef<IntersectionObserver | null>(null)
  const callbacks = useRef(new Map<string, (el: HTMLElement | null) => (() => void) | undefined>())

  const getObserver = useCallback(() => {
    if (!observerRef.current) {
      observerRef.current = new IntersectionObserver((entries) => {
        for (const entry of entries) {
          const id = (entry.target as HTMLElement).dataset.stop
          if (id) ratios.current.set(id, entry.isIntersecting ? entry.intersectionRatio * entry.boundingClientRect.height : 0)
        }
        let best = initial
        let bestSize = -1
        for (const [id, size] of ratios.current) {
          if (size > bestSize) {
            best = id
            bestSize = size
          }
        }
        setActive(best)
      }, { threshold: THRESHOLDS })
    }
    return observerRef.current
  }, [initial])

  useEffect(() => () => observerRef.current?.disconnect(), [])

  const observe = useCallback(
    (id: string) => {
      let callback = callbacks.current.get(id)
      if (!callback) {
        callback = (el: HTMLElement | null) => {
          if (!el) return undefined
          const observer = getObserver()
          observer.observe(el)
          return () => {
            observer.unobserve(el)
            ratios.current.delete(id)
          }
        }
        callbacks.current.set(id, callback)
      }
      return callback
    },
    [getObserver],
  )

  return { active, observe }
}

/**
 * True once the element comes within `margin` of the screen, and stays true —
 * used to reveal a stop and to start loading its album art just before arrival.
 */
export function useArrived<T extends HTMLElement>(margin = '0px') {
  const [arrived, setArrived] = useState(false)
  const ref = useCallback(
    (el: T | null) => {
      if (!el || arrived) return undefined
      const observer = new IntersectionObserver(
        ([entry]) => {
          if (entry.isIntersecting) {
            setArrived(true)
            observer.disconnect()
          }
        },
        { rootMargin: margin, threshold: 0.12 },
      )
      observer.observe(el)
      return () => observer.disconnect()
    },
    [arrived, margin],
  )
  return { ref, arrived }
}

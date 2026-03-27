import { useRef, useState, useCallback, useEffect } from 'react'

type PullState = 'idle' | 'pulling' | 'threshold' | 'refreshing'

interface UsePullToRefreshOptions {
  onRefresh: () => Promise<void>
  threshold?: number
  maxPull?: number
  disabled?: boolean
}

interface UsePullToRefreshReturn {
  scrollRef: React.RefObject<HTMLDivElement | null>
  pullDistance: number
  state: PullState
}

const DEFAULT_THRESHOLD = 80
const DEFAULT_MAX_PULL = 120
const DAMPING_FACTOR = 0.4

export function usePullToRefresh({
  onRefresh,
  threshold = DEFAULT_THRESHOLD,
  maxPull = DEFAULT_MAX_PULL,
  disabled = false,
}: UsePullToRefreshOptions): UsePullToRefreshReturn {
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const startYRef = useRef(0)
  const activeRef = useRef(false)
  const [pullDistance, setPullDistance] = useState(0)
  const [state, setState] = useState<PullState>('idle')

  const prefersReducedMotion = useRef(false)
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    prefersReducedMotion.current = mq.matches
    const handler = (e: MediaQueryListEvent) => {
      prefersReducedMotion.current = e.matches
    }
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  const snapBack = useCallback(() => {
    setPullDistance(0)
    setState('idle')
  }, [])

  const handleRefresh = useCallback(async () => {
    setState('refreshing')
    try {
      await onRefresh()
    } finally {
      snapBack()
    }
  }, [onRefresh, snapBack])

  useEffect(() => {
    const el = scrollRef.current
    if (!el || disabled) return

    const onTouchStart = (e: TouchEvent) => {
      if (state === 'refreshing') return
      if (el.scrollTop > 0) return

      startYRef.current = e.touches[0].clientY
      activeRef.current = true
    }

    const onTouchMove = (e: TouchEvent) => {
      if (!activeRef.current || state === 'refreshing') return

      const currentY = e.touches[0].clientY
      const deltaY = currentY - startYRef.current

      if (deltaY <= 0 || el.scrollTop > 0) {
        if (pullDistance > 0) {
          setPullDistance(0)
          setState('idle')
        }
        activeRef.current = false
        return
      }

      e.preventDefault()

      const dampened = Math.min(maxPull, deltaY * DAMPING_FACTOR)
      setPullDistance(dampened)
      setState(dampened >= threshold ? 'threshold' : 'pulling')
    }

    const onTouchEnd = () => {
      if (!activeRef.current) return
      activeRef.current = false

      if (state === 'threshold') {
        handleRefresh()
      } else {
        snapBack()
      }
    }

    el.addEventListener('touchstart', onTouchStart, { passive: true })
    el.addEventListener('touchmove', onTouchMove, { passive: false })
    el.addEventListener('touchend', onTouchEnd, { passive: true })

    return () => {
      el.removeEventListener('touchstart', onTouchStart)
      el.removeEventListener('touchmove', onTouchMove)
      el.removeEventListener('touchend', onTouchEnd)
    }
  }, [disabled, state, pullDistance, threshold, maxPull, handleRefresh, snapBack])

  return { scrollRef, pullDistance, state }
}

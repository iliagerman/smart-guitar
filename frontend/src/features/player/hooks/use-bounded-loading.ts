import { useEffect, useState } from 'react'

/** True while `loading` has lasted less than `ms`; resets when loading ends. */
export function useBoundedLoading(loading: boolean, ms: number): boolean {
  const [expired, setExpired] = useState(false)
  // Reset when loading ends, so a later lookup gets its own time budget.
  const [wasLoading, setWasLoading] = useState(loading)
  if (loading !== wasLoading) {
    setWasLoading(loading)
    if (!loading) setExpired(false)
  }
  useEffect(() => {
    if (!loading) return
    const timer = window.setTimeout(() => setExpired(true), ms)
    return () => window.clearTimeout(timer)
  }, [loading, ms])
  return loading && !expired
}

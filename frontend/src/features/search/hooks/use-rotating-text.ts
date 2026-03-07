import { useState, useEffect } from 'react'

const INTERVAL_MS = 2500

export function useRotatingText(phrases: string[], active: boolean): string {
  const [index, setIndex] = useState(0)

  useEffect(() => {
    if (!active) {
      return
    }
    const id = setInterval(() => {
      setIndex((prev) => (prev + 1) % phrases.length)
    }, INTERVAL_MS)
    return () => clearInterval(id)
  }, [active, phrases.length])

  return active ? phrases[index] : phrases[0] ?? ''
}

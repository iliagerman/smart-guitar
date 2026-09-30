const SEED_KEY = 'home-shuffle-seed'

/**
 * A number fixed for this visit (the browser session): the home page's picks
 * change from one visit to the next, but not while you're looking at them.
 */
export function visitSeed(): number {
  try {
    const stored = Number(sessionStorage.getItem(SEED_KEY))
    if (stored) return stored
    const seed = 1 + Math.floor(Math.random() * 2 ** 31)
    sessionStorage.setItem(SEED_KEY, String(seed))
    return seed
  } catch {
    return 1
  }
}

/** A small stable number for a string, so each strip gets its own order. */
export function hashString(value: string): number {
  let hash = 2166136261
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

/** mulberry32: a tiny seeded random number generator. */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** The items in an order fixed by `seed`: the same seed always gives the same order. */
export function seededShuffle<T>(items: readonly T[], seed: number): T[] {
  const random = seededRandom(seed)
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

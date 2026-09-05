import { useEffect, useState } from 'react'

export type ScreenWakeLockStatus = 'idle' | 'requesting' | 'active' | 'unavailable'

function releaseWakeLock(lock: WakeLockSentinel): void {
  void lock.release().catch((error: unknown) => {
    console.error('Failed to release screen wake lock', error)
  })
}

export function useScreenWakeLock(enabled: boolean): ScreenWakeLockStatus {
  const [status, setStatus] = useState<ScreenWakeLockStatus>('idle')
  useEffect(() => {
    if (!enabled) {
      setStatus('idle')
      return
    }
    if (!('wakeLock' in navigator)) {
      setStatus('unavailable')
      return
    }
    let cancelled = false
    let requesting = false
    let lock: WakeLockSentinel | null = null
    const requestLock = async (): Promise<void> => {
      if (requesting || (lock && !lock.released)) return
      requesting = true
      setStatus('requesting')
      try {
        const nextLock = await navigator.wakeLock.request('screen')
        if (cancelled) {
          releaseWakeLock(nextLock)
          return
        }
        lock = nextLock
        lock.addEventListener('release', () => {
          if (!cancelled) setStatus('unavailable')
        }, { once: true })
        setStatus('active')
      } catch {
        if (!cancelled) setStatus('unavailable')
      } finally {
        requesting = false
      }
    }
    const handleVisibilityChange = (): void => {
      if (document.visibilityState === 'visible') void requestLock()
    }
    void requestLock()
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      if (lock && !lock.released) releaseWakeLock(lock)
    }
  }, [enabled])
  return status
}

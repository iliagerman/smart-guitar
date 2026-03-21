import { useEffect, useRef } from 'react'

export function useWakeLock(active: boolean) {
  const wakeLockRef = useRef<WakeLockSentinel | null>(null)

  useEffect(() => {
    if (!('wakeLock' in navigator)) return

    const acquire = async () => {
      try {
        wakeLockRef.current = await navigator.wakeLock.request('screen')
        wakeLockRef.current.addEventListener('release', () => {
          wakeLockRef.current = null
        })
      } catch {
        // Request can fail if the page is hidden or permissions are denied.
      }
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && active) {
        void acquire()
      }
    }

    if (active) {
      void acquire()
      document.addEventListener('visibilitychange', handleVisibilityChange)
    } else {
      void wakeLockRef.current?.release()
      wakeLockRef.current = null
    }

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      void wakeLockRef.current?.release()
      wakeLockRef.current = null
    }
  }, [active])
}

import { useEffect } from 'react'

import { isMobilePhoneDevice } from '@/lib/device'

/**
 * Disables pinch/double-tap viewport zoom on mobile phones to avoid accidental
 * scaling while interacting with the player UI.
 */
export function MobileViewportLock() {
  useEffect(() => {
    if (!isMobilePhoneDevice()) {
      return
    }

    const viewportMeta = document.querySelector('meta[name="viewport"]')
    if (!(viewportMeta instanceof HTMLMetaElement)) {
      return
    }

    const previousContent = viewportMeta.content
    viewportMeta.content = 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover'

    return () => {
      viewportMeta.content = previousContent
    }
  }, [])

  return null
}

/**
 * Meta Pixel (Facebook Pixel) tracking utility.
 *
 * Provides type-safe wrappers around the fbq() global so event calls
 * are centralised in one place and the rest of the codebase never
 * touches `window.fbq` directly.
 */

const PIXEL_ID = '547626808918712'

declare global {
  interface Window {
    fbq?: (...args: unknown[]) => void
    _fbq?: (...args: unknown[]) => void
  }
}

/** Initialise the Meta Pixel base code (call once on app boot). */
export function initMetaPixel(): void {
  if (typeof window.fbq === 'function') return

  /* eslint-disable */
  ;(function (f: Window, b: Document, e: string, v: string) {
    const n: any = (f.fbq = function (...args: unknown[]) {
      n.callMethod ? n.callMethod(...args) : n.queue.push(args)
    })
    if (!f._fbq) f._fbq = n
    n.push = n
    n.loaded = true
    n.version = '2.0'
    n.queue = [] as unknown[]
    const t = b.createElement(e) as HTMLScriptElement
    t.async = true
    t.src = v
    const s = b.getElementsByTagName(e)[0]
    s.parentNode!.insertBefore(t, s)
  })(window, document, 'script', 'https://connect.facebook.net/en_US/fbevents.js')
  /* eslint-enable */

  window.fbq!('init', PIXEL_ID)
  window.fbq!('track', 'PageView')
}

/** Fire a standard Meta Pixel event. */
export function trackEvent(event: string, params?: Record<string, unknown>): void {
  if (typeof window.fbq !== 'function') return
  if (params) {
    window.fbq('track', event, params)
  } else {
    window.fbq('track', event)
  }
}

/** Fire a custom Meta Pixel event. */
export function trackCustomEvent(event: string, params?: Record<string, unknown>): void {
  if (typeof window.fbq !== 'function') return
  if (params) {
    window.fbq('trackCustom', event, params)
  } else {
    window.fbq('trackCustom', event)
  }
}

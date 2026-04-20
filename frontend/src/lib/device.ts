function getUserAgent(): string {
  if (typeof navigator === 'undefined') return ''
  return navigator.userAgent
}

/**
 * Returns true for iPhone/iPod Safari and Safari-based standalone web apps.
 * iPad desktop-mode Safari is included because it shares the same WebKit audio behavior.
 */
export function isAppleMobileSafariLike(): boolean {
  if (typeof navigator === 'undefined') return false

  const userAgent = getUserAgent()
  const isIPhoneOrIPod = /iPhone|iPod/i.test(userAgent)
  const isIPadDesktopMode = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1
  const isAppleMobile = isIPhoneOrIPod || isIPadDesktopMode
  const isWebKit = /AppleWebKit/i.test(userAgent)
  const isOtherIOSBrowser = /CriOS|FxiOS|EdgiOS|OPiOS|YaBrowser|DuckDuckGo|GSA/i.test(userAgent)

  return isAppleMobile && isWebKit && !isOtherIOSBrowser
}

/**
 * Returns true for small touch-first phone layouts where pinch/double-tap zoom
 * should be disabled to avoid accidental viewport scaling during playback.
 */
export function isMobilePhoneDevice(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false

  const userAgent = getUserAgent()
  const hasTouch = navigator.maxTouchPoints > 0
  const isPhoneUserAgent = /iPhone|Android.+Mobile|Mobile/i.test(userAgent)
  const shortestScreenSide = Math.min(window.screen.width, window.screen.height)

  return hasTouch && isPhoneUserAgent && shortestScreenSide <= 768
}

import type { ClientInfo } from '@/types/analytics'

/** What the browser reports about itself; split out so the parsing is testable. */
export interface ClientEnvironment {
  userAgent: string
  platform: string
  maxTouchPoints: number
  /** Launched from the home screen as an installed app. */
  standalone: boolean
  viewportWidth: number
  viewportHeight: number
  appVersion: string
}

const UNKNOWN = 'Unknown'

/** "18_5_1" / "18.5.1" → "18.5" */
function majorMinor(version: string): string {
  return version.split(/[._]/).slice(0, 2).join('.')
}

function isIPadPosingAsMac(env: ClientEnvironment): boolean {
  return env.platform === 'MacIntel' && env.maxTouchPoints > 1
}

function describeDevice(env: ClientEnvironment): string {
  const ua = env.userAgent
  if (/iPhone/.test(ua)) return 'iPhone'
  if (/iPod/.test(ua)) return 'iPod'
  if (/iPad/.test(ua) || isIPadPosingAsMac(env)) return 'iPad'
  if (/Android/.test(ua)) return /Mobile/.test(ua) ? 'Android phone' : 'Android tablet'
  if (/Macintosh/.test(ua)) return 'Mac'
  if (/Windows/.test(ua)) return 'Windows PC'
  if (/CrOS/.test(ua)) return 'Chromebook'
  if (/Linux/.test(ua)) return 'Linux PC'
  return UNKNOWN
}

function describeOs(env: ClientEnvironment): string {
  const ua = env.userAgent
  const ios = /(iPhone|iPod|iPad).*? OS (\d+(?:_\d+)*)/.exec(ua)
  if (ios) return `${ios[1] === 'iPad' ? 'iPadOS' : 'iOS'} ${majorMinor(ios[2])}`
  if (isIPadPosingAsMac(env)) {
    // Desktop-mode iPad reports a Mac; Safari's own version tracks the iPadOS version.
    const safari = /Version\/(\d+(?:\.\d+)*)/.exec(ua)
    return safari ? `iPadOS ${majorMinor(safari[1])}` : 'iPadOS'
  }
  const android = /Android (\d+(?:\.\d+)*)/.exec(ua)
  if (android) return `Android ${android[1]}`
  // Mac and Windows user agents are frozen at an old version number, so name the OS only.
  if (/Macintosh/.test(ua)) return 'macOS'
  if (/Windows/.test(ua)) return 'Windows'
  if (/CrOS/.test(ua)) return 'ChromeOS'
  if (/Linux/.test(ua)) return 'Linux'
  return UNKNOWN
}

// First match wins: every Chromium browser also says "Chrome" and "Safari".
const BROWSERS: ReadonlyArray<[name: string, pattern: RegExp]> = [
  ['Instagram in-app', /Instagram/],
  ['Facebook in-app', /FBAN|FBAV/],
  ['TikTok in-app', /musical_ly|BytedanceWebview/],
  ['Google app', /GSA\//],
  ['Edge', /(?:Edg|EdgiOS|EdgA)\/(\d+)/],
  ['Opera', /(?:OPR|OPiOS)\/(\d+)/],
  ['Samsung Internet', /SamsungBrowser\/(\d+)/],
  ['Firefox', /(?:Firefox|FxiOS)\/(\d+)/],
  ['Chrome', /(?:Chrome|CriOS)\/(\d+)/],
  ['Safari', /Version\/(\d+(?:\.\d+)?).*Safari\//],
]

function describeBrowser(env: ClientEnvironment): string {
  for (const [name, pattern] of BROWSERS) {
    const match = pattern.exec(env.userAgent)
    if (match) return match[1] ? `${name} ${match[1]}` : name
  }
  // An installed iOS app runs in a web view whose user agent names no browser.
  if (env.standalone) return 'Home screen app'
  return UNKNOWN
}

/** Summarises the device and browser for analytics. */
export function describeClient(env: ClientEnvironment): ClientInfo {
  return {
    device: describeDevice(env),
    os: describeOs(env),
    browser: describeBrowser(env),
    standalone: env.standalone,
    viewport: `${env.viewportWidth}x${env.viewportHeight}`,
    app_version: env.appVersion,
  }
}

/** The device, browser and app build this page is running on. */
export function getClientInfo(): ClientInfo {
  return describeClient({
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    maxTouchPoints: navigator.maxTouchPoints,
    standalone:
      window.matchMedia('(display-mode: standalone)').matches ||
      (navigator as { standalone?: boolean }).standalone === true,
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
    appVersion: __APP_VERSION__,
  })
}

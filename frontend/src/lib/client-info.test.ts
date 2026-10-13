import { describe, it, expect } from 'vitest'
import { describeClient, type ClientEnvironment } from './client-info'

function client(userAgent: string, overrides: Partial<ClientEnvironment> = {}) {
  return describeClient({
    userAgent,
    platform: '',
    maxTouchPoints: 0,
    standalone: false,
    viewportWidth: 390,
    viewportHeight: 844,
    appVersion: 'v1300 · 0af270d · 2026-10-13 09:00',
    ...overrides,
  })
}

const IPHONE_SAFARI =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1'
const IPHONE_CHROME =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_6_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/141.0.7390.41 Mobile/15E148 Safari/604.1'
const IPHONE_INSTAGRAM =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 350.0.0.20.80 (iPhone15,2; iOS 18_5; en_US; en; scale=3.00; 1179x2556; 650123456)'
const IPHONE_HOME_SCREEN =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148'
const IPAD_DESKTOP_MODE =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15'
const ANDROID_CHROME =
  'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36'
const ANDROID_SAMSUNG =
  'Mozilla/5.0 (Linux; Android 14; SAMSUNG SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/27.0 Chrome/125.0.0.0 Mobile Safari/537.36'
const ANDROID_TABLET =
  'Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36'
const MAC_CHROME =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36'
const WINDOWS_EDGE =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0'
const WINDOWS_FIREFOX = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:143.0) Gecko/20100101 Firefox/143.0'

describe('describeClient', () => {
  it('names an iPhone in Safari with its iOS and Safari versions', () => {
    expect(client(IPHONE_SAFARI)).toEqual({
      device: 'iPhone',
      os: 'iOS 18.5',
      browser: 'Safari 18.5',
      standalone: false,
      viewport: '390x844',
      app_version: 'v1300 · 0af270d · 2026-10-13 09:00',
    })
  })

  it('tells the other iPhone browsers and in-app browsers apart from Safari', () => {
    expect(client(IPHONE_CHROME)).toMatchObject({ device: 'iPhone', os: 'iOS 17.6', browser: 'Chrome 141' })
    expect(client(IPHONE_INSTAGRAM)).toMatchObject({ device: 'iPhone', browser: 'Instagram in-app' })
  })

  it('reports the home-screen app, whose user agent names no browser', () => {
    expect(client(IPHONE_HOME_SCREEN, { standalone: true })).toMatchObject({
      device: 'iPhone',
      os: 'iOS 18.5',
      browser: 'Home screen app',
      standalone: true,
    })
  })

  it('recognises an iPad that presents itself as a Mac', () => {
    expect(client(IPAD_DESKTOP_MODE, { platform: 'MacIntel', maxTouchPoints: 5 })).toMatchObject({
      device: 'iPad',
      os: 'iPadOS 18.5',
      browser: 'Safari 18.5',
    })
    expect(client(IPAD_DESKTOP_MODE, { platform: 'MacIntel' })).toMatchObject({
      device: 'Mac',
      os: 'macOS',
      browser: 'Safari 18.5',
    })
  })

  it('names Android phones and tablets with their browser', () => {
    expect(client(ANDROID_CHROME)).toMatchObject({ device: 'Android phone', os: 'Android 15', browser: 'Chrome 141' })
    expect(client(ANDROID_SAMSUNG)).toMatchObject({ device: 'Android phone', os: 'Android 14', browser: 'Samsung Internet 27' })
    expect(client(ANDROID_TABLET)).toMatchObject({ device: 'Android tablet', browser: 'Chrome 141' })
  })

  it('names desktop browsers', () => {
    expect(client(MAC_CHROME, { platform: 'MacIntel' })).toMatchObject({ device: 'Mac', os: 'macOS', browser: 'Chrome 141' })
    expect(client(WINDOWS_EDGE)).toMatchObject({ device: 'Windows PC', os: 'Windows', browser: 'Edge 141' })
    expect(client(WINDOWS_FIREFOX)).toMatchObject({ device: 'Windows PC', browser: 'Firefox 143' })
  })

  it('falls back to "Unknown" rather than guessing', () => {
    expect(client('curl/8.7.1')).toMatchObject({ device: 'Unknown', os: 'Unknown', browser: 'Unknown' })
  })
})

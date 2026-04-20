function parseAudioSource(url: string): URL | null {
  try {
    return new URL(url, window.location.href)
  } catch {
    return null
  }
}

/**
 * Returns a stable cache key for an audio source.
 * Presigned S3 URLs rotate query params while still pointing to the same object.
 */
export function getAudioSourceKey(url: string): string {
  if (!url) return ''
  const parsed = parseAudioSource(url)
  if (!parsed) return url
  if (parsed.hostname.includes('.s3.') || parsed.hostname.includes('.amazonaws.com')) {
    return `${parsed.origin}${parsed.pathname}`
  }
  return `${parsed.origin}${parsed.pathname}${parsed.search}`
}

/**
 * Returns a stable key for the folder/group that owns an audio file.
 */
export function getAudioSourceGroupKey(url: string): string {
  const parsed = parseAudioSource(url)
  if (!parsed) return ''
  const pathname = parsed.pathname.replace(/\/[^/]+$/, '')
  return `${parsed.origin}${pathname}`
}

/**
 * Tests whether two URLs refer to the same underlying audio object.
 */
export function isSameAudioSource(currentUrl: string, nextUrl: string): boolean {
  if (!currentUrl || !nextUrl) return false
  return getAudioSourceKey(currentUrl) === getAudioSourceKey(nextUrl)
}

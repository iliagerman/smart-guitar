import { env } from '@/config/env'

/**
 * Convert internal slugs (snake_case / kebab-case) into human-friendly display text.
 *
 * Examples:
 * - the_animals -> The Animals
 * - house_of_the_rising_sun -> House Of The Rising Sun
 */

export function slugToTitleCase(input: string | null | undefined): string {
  const raw = (input ?? '').trim()
  if (!raw) return ''

  // If it's not a simple slug, don't try to be clever.
  // (e.g. already a proper name, contains punctuation, non-latin scripts, etc.)
  const looksLikeSlug = /^[\p{L}\p{N}_\s-]+$/u.test(raw) && (raw.includes('_') || raw.includes('-'))
  const normalized = raw.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim()

  if (!looksLikeSlug) {
    // Still normalize whitespace a bit.
    return normalized
  }

  return normalized
    .split(' ')
    .filter(Boolean)
    .map((w) => {
      // Preserve numeric tokens (e.g. "5")
      if (/^\d+$/.test(w)) return w
      // Single-letter tokens like "n" → "N"
      if (w.length === 1) return w.toUpperCase()

      // Basic Title Case
      return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()
    })
    .join(' ')
}

export function splitSongName(songName: string | null | undefined): { artistSlug: string; songSlug: string } {
  const raw = (songName ?? '').trim()
  if (!raw) return { artistSlug: '', songSlug: '' }
  const [artistSlug = '', songSlug = ''] = raw.split('/', 2)
  return { artistSlug, songSlug }
}

export function displaySongTitle(song: { title: string; song_name: string } | null | undefined): string {
  if (!song) return ''
  const { songSlug } = splitSongName(song.song_name)
  return slugToTitleCase(songSlug) || song.title
}

export function displayArtistName(song: { artist: string | null; song_name: string } | null | undefined): string {
  if (!song) return ''
  const { artistSlug } = splitSongName(song.song_name)

  // Prefer the song_name slug because DB `artist` may be either snake_case or already human.
  const fromSlug = slugToTitleCase(artistSlug)
  if (fromSlug) return fromSlug

  return slugToTitleCase(song.artist) || (song.artist ?? '')
}

/**
 * Resolve the thumbnail URL for a song.
 * In local dev the backend returns a filesystem path which the browser can't load,
 * so we route through the /stream endpoint instead.
 */
export function getThumbnailUrl(song: { id: string; thumbnail_url?: string | null }): string | null {
  if (!song.thumbnail_url) return null
  if (env.isLocal) {
    return `${env.apiBaseUrl}/api/v1/songs/${song.id}/stream?stem=thumbnail`
  }
  return song.thumbnail_url
}

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

function splitSongName(songName: string | null | undefined): { artistSlug: string; songSlug: string } {
  const raw = (songName ?? '').trim()
  if (!raw) return { artistSlug: '', songSlug: '' }
  const [artistSlug = '', songSlug = ''] = raw.split('/', 2)
  return { artistSlug, songSlug }
}

/**
 * True for names that are already written for people ("AC/DC", "Knockin' On
 * Heaven's Door", Hebrew titles) rather than lowercase storage slugs ("rem",
 * "you_shook_me").
 */
function looksHuman(value: string): boolean {
  return !value.includes('_') && /[\p{Lu}]|[^\p{Ll}\p{N}\s-]/u.test(value)
}

/** Title-cases a slug, single lowercase words included ("rem" -> "Rem"). */
function slugDisplay(slug: string): string {
  const titled = slugToTitleCase(slug)
  return /^[a-z]/.test(titled) ? titled.charAt(0).toUpperCase() + titled.slice(1) : titled
}

function displayName(dbValue: string | null, slug: string): string {
  const value = (dbValue ?? '').trim()
  if (value && looksHuman(value)) return value
  return slugDisplay(slug) || slugToTitleCase(value)
}

export function displaySongTitle(song: { title: string; song_name: string } | null | undefined): string {
  if (!song) return ''
  return displayName(song.title, splitSongName(song.song_name).songSlug)
}

export function displayArtistName(song: { artist: string | null; song_name: string } | null | undefined): string {
  if (!song) return ''
  // DB `artist` may be snake_case or already human; prefer it only when it reads well.
  return displayName(song.artist, splitSongName(song.song_name).artistSlug)
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

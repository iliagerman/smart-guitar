import { formatChordName } from '@/lib/chord-colors'
import { normalizeNoteToSharps } from '@/lib/chord-utils'
import { getPrimaryVoicing, type ChordVoicing } from './chord-shapes'

export type { ChordVoicing } from './chord-shapes'

/** Minimal shape of one position in @tombatossals/chords-db. */
export interface DbPosition {
  frets: number[]
  fingers: number[]
  baseFret: number
  barres: number[]
  capo?: boolean
}

interface DbChord {
  key: string
  suffix: string
  positions: DbPosition[]
}

/** Minimal shape of @tombatossals/chords-db's guitar.json that we rely on. */
export interface GuitarChordDb {
  chords: Record<string, DbChord[]>
}

// Sharp-spelled root note -> the chord-group key used by chords-db, which spells
// C#/F# as "Csharp"/"Fsharp" and the rest as flats (Eb/Ab/Bb).
const ROOT_TO_DB_KEY: Record<string, string> = {
  C: 'C',
  'C#': 'Csharp',
  D: 'D',
  'D#': 'Eb',
  E: 'E',
  F: 'F',
  'F#': 'Fsharp',
  G: 'G',
  'G#': 'Ab',
  A: 'A',
  'A#': 'Bb',
  B: 'B',
}

// Display/MIREX chord suffix (as produced by formatChordName) -> chords-db suffix key.
const SUFFIX_TO_DB: Record<string, string> = {
  '': 'major',
  m: 'minor',
  min: 'minor',
  maj: 'major',
  dim: 'dim',
  dim7: 'dim7',
  aug: 'aug',
  '+': 'aug',
  sus2: 'sus2',
  sus4: 'sus4',
  '7sus4': '7sus4',
  '6': '6',
  '6/9': '69',
  '69': '69',
  '7': '7',
  '7b5': '7b5',
  '9': '9',
  '9b5': '9b5',
  '11': '11',
  '13': '13',
  maj7: 'maj7',
  M7: 'maj7',
  maj9: 'maj9',
  maj11: 'maj11',
  maj13: 'maj13',
  m6: 'm6',
  m7: 'm7',
  m7b5: 'm7b5',
  m9: 'm9',
  m11: 'm11',
  mmaj7: 'mmaj7',
  mM7: 'mmaj7',
  add9: 'add9',
  madd9: 'madd9',
  aug7: 'aug7',
  aug9: 'aug9',
}

/**
 * Split a slash chord into its root chord and bass note (C/G -> {C, G}).
 * Extension slashes (C6/9) are NOT slash basses and stay on the root.
 */
export function splitSlashBass(name: string): { root: string; bass: string | null } {
  const slashIdx = name.lastIndexOf('/')
  if (slashIdx <= 0) return { root: name, bass: null }
  const after = name.slice(slashIdx + 1)
  if (!/^[A-G][#b]?$/.test(after)) return { root: name, bass: null }
  return { root: name.slice(0, slashIdx), bass: after }
}

/** Drop a trailing slash bass note (C/G -> C). Keeps extension slashes (C6/9). */
function stripSlashBass(name: string): string {
  return splitSlashBass(name).root
}

/**
 * Resolve a chord label (display or backend MIREX notation) to the (key, suffix)
 * pair chords-db indexes by. Returns null for the no-chord token, unparseable
 * names, or qualities the database does not cover.
 */
export function chordNameToDbLookup(name: string): { key: string; suffix: string } | null {
  const trimmed = (name || '').trim()
  if (!trimmed) return null

  const formatted = formatChordName(trimmed)
  if (!formatted || formatted === 'N') return null

  const main = stripSlashBass(formatted)
  const match = /^([A-G][#b]?)(.*)$/.exec(main)
  if (!match) return null

  const dbKey = ROOT_TO_DB_KEY[normalizeNoteToSharps(match[1])]
  if (!dbKey) return null

  const dbSuffix = SUFFIX_TO_DB[match[2]]
  if (dbSuffix === undefined) return null

  return { key: dbKey, suffix: dbSuffix }
}

/**
 * Convert a chords-db position (frets relative to baseFret, -1 muted / 0 open)
 * into our normalized voicing with ABSOLUTE fret numbers.
 */
export function dbPositionToVoicing(pos: DbPosition): ChordVoicing {
  const toAbsolute = (fret: number): number => (fret <= 0 ? fret : pos.baseFret + fret - 1)
  return {
    frets: pos.frets.map(toAbsolute),
    fingers: pos.fingers ?? [0, 0, 0, 0, 0, 0],
    baseFret: pos.baseFret,
    barres: (pos.barres ?? []).map((barre) => pos.baseFret + barre - 1),
    capo: pos.capo,
  }
}

// Standard tuning, low E to high E, as MIDI note numbers (E2 A2 D3 G3 B3 E4).
const STANDARD_TUNING_MIDI = [40, 45, 50, 55, 59, 64]

const NOTE_TO_PITCH_CLASS: Record<string, number> = {
  C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6,
  G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11,
}

/** Pitch class (0-11) for a note name like "F#"/"Bb", or null when unknown. */
export function noteToPitchClass(note: string): number | null {
  return NOTE_TO_PITCH_CLASS[note] ?? null
}

/** Pitch class (0-11) of the lowest sounding string, or null when all muted. */
export function lowestSoundingPitchClass(voicing: ChordVoicing): number | null {
  for (let s = 0; s < voicing.frets.length; s++) {
    const fret = voicing.frets[s]
    if (fret >= 0) return (STANDARD_TUNING_MIDI[s] + fret) % 12
  }
  return null
}

/**
 * Re-bass a voicing so the given pitch class sounds as its lowest note:
 * pick the lowest string that can reach the bass note within the hand span,
 * set it there, and mute any strings below it (how players actually voice
 * C/G, D/F#, G/B...). Returns null when no string can reach the note.
 */
export function adaptVoicingToBass(voicing: ChordVoicing, bassPc: number): ChordVoicing | null {
  const maxReach = Math.max(4, voicing.baseFret + 3)
  for (let s = 0; s < 2; s++) {
    // Candidate frets on this string producing the bass pitch class.
    for (let fret = 0; fret <= maxReach; fret++) {
      if ((STANDARD_TUNING_MIDI[s] + fret) % 12 !== bassPc) continue
      // Keep the shape playable: open string, or within the fretting span.
      const inSpan = fret === 0 || (voicing.baseFret <= 1 ? fret <= 4 : Math.abs(fret - voicing.baseFret) <= 3)
      if (!inSpan) continue
      const frets = [...voicing.frets]
      const fingers = [...voicing.fingers]
      frets[s] = fret
      fingers[s] = 0
      for (let below = 0; below < s; below++) {
        frets[below] = -1
        fingers[below] = 0
      }
      return { ...voicing, frets, fingers }
    }
  }
  return null
}

/**
 * Resolve every voicing for a chord from an already-loaded chords-db object.
 * Pure (no I/O) so it can be unit-pinned against known chords.
 *
 * Slash chords (C/G) resolve to TRUE inversions: database voicings whose
 * lowest sounding note already is the bass, then shapes re-bassed via
 * adaptVoicingToBass, falling back to the plain root voicings only when
 * the bass note is unreachable.
 */
export function resolveVoicingsFromDb(name: string, db: GuitarChordDb): ChordVoicing[] {
  const lookup = chordNameToDbLookup(name)
  if (!lookup) return []

  const group = db.chords[lookup.key]
  if (!group) return []

  const entry = group.find((chord) => chord.suffix === lookup.suffix)
  if (!entry) return []

  const rootVoicings = entry.positions.map(dbPositionToVoicing)

  const { bass } = splitSlashBass(formatChordName(name))
  const bassPc = bass != null ? NOTE_TO_PITCH_CLASS[bass] : undefined
  if (bassPc === undefined) return rootVoicings

  const natural = rootVoicings.filter((v) => lowestSoundingPitchClass(v) === bassPc)
  const adapted = rootVoicings
    .map((v) => adaptVoicingToBass(v, bassPc))
    .filter((v): v is ChordVoicing => v !== null && lowestSoundingPitchClass(v) === bassPc)

  const inversions = [...natural, ...adapted]
  return inversions.length > 0 ? inversions : rootVoicings
}

/**
 * Load the curated voicings for a chord, lazily importing the chord database so
 * it stays out of the initial bundle. Falls back to the built-in primary shape
 * when the database has no entry for the chord.
 */
export async function loadChordVoicings(name: string): Promise<ChordVoicing[]> {
  const module = await import('@tombatossals/chords-db/lib/guitar.json')
  const db = (module.default ?? module) as unknown as GuitarChordDb

  const fromDb = resolveVoicingsFromDb(name, db)
  if (fromDb.length > 0) return fromDb

  const primary = getPrimaryVoicing(name)
  return primary ? [primary] : []
}

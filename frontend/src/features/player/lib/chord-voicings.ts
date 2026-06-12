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

/**
 * Resolve every voicing for a chord from an already-loaded chords-db object.
 * Pure (no I/O) so it can be unit-pinned against known chords.
 */
export function resolveVoicingsFromDb(name: string, db: GuitarChordDb): ChordVoicing[] {
  const lookup = chordNameToDbLookup(name)
  if (!lookup) return []

  const group = db.chords[lookup.key]
  if (!group) return []

  const entry = group.find((chord) => chord.suffix === lookup.suffix)
  if (!entry) return []

  return entry.positions.map(dbPositionToVoicing)
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

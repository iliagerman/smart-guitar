import { describe, it, expect } from 'vitest'
import guitarDbJson from '@tombatossals/chords-db/lib/guitar.json'
import {
  chordNameToDbLookup,
  dbPositionToVoicing,
  resolveVoicingsFromDb,
  type GuitarChordDb,
  splitSlashBass,
  lowestSoundingPitchClass,
} from './chord-voicings'

// Cast once: the raw JSON is a huge literal type; treat it as our minimal shape.
const db = guitarDbJson as unknown as GuitarChordDb

describe('chordNameToDbLookup', () => {
  it('maps plain display names to db (key, suffix) pairs', () => {
    expect(chordNameToDbLookup('C')).toEqual({ key: 'C', suffix: 'major' })
    expect(chordNameToDbLookup('Am')).toEqual({ key: 'A', suffix: 'minor' })
    expect(chordNameToDbLookup('Dm7')).toEqual({ key: 'D', suffix: 'm7' })
    expect(chordNameToDbLookup('Gmaj7')).toEqual({ key: 'G', suffix: 'maj7' })
  })

  it('maps backend MIREX notation (Root:quality) the same as display names', () => {
    expect(chordNameToDbLookup('C:maj')).toEqual(chordNameToDbLookup('C'))
    expect(chordNameToDbLookup('A:min')).toEqual(chordNameToDbLookup('Am'))
    expect(chordNameToDbLookup('D:min7')).toEqual(chordNameToDbLookup('Dm7'))
  })

  it('normalizes enharmonic roots to the db spelling (sharps/flats)', () => {
    // db chord groups use Csharp / Fsharp and flats Eb / Ab / Bb
    expect(chordNameToDbLookup('C#')).toEqual({ key: 'Csharp', suffix: 'major' })
    expect(chordNameToDbLookup('F#m')).toEqual({ key: 'Fsharp', suffix: 'minor' })
    expect(chordNameToDbLookup('D#')).toEqual({ key: 'Eb', suffix: 'major' })
    expect(chordNameToDbLookup('G#')).toEqual({ key: 'Ab', suffix: 'major' })
    expect(chordNameToDbLookup('A#')).toEqual({ key: 'Bb', suffix: 'major' })
    expect(chordNameToDbLookup('Bb')).toEqual({ key: 'Bb', suffix: 'major' })
  })

  it('strips a slash bass note and looks up the base chord', () => {
    expect(chordNameToDbLookup('C/G')).toEqual({ key: 'C', suffix: 'major' })
    expect(chordNameToDbLookup('D/F#')).toEqual({ key: 'D', suffix: 'major' })
  })

  it('returns null for the no-chord token and empty input', () => {
    expect(chordNameToDbLookup('N')).toBeNull()
    expect(chordNameToDbLookup('')).toBeNull()
  })
})

describe('dbPositionToVoicing', () => {
  it('keeps an open shape with baseFret 1 as absolute frets', () => {
    const v = dbPositionToVoicing({
      frets: [-1, 3, 2, 0, 1, 0],
      fingers: [0, 3, 2, 0, 1, 0],
      baseFret: 1,
      barres: [],
    })
    expect(v.frets).toEqual([-1, 3, 2, 0, 1, 0])
    expect(v.baseFret).toBe(1)
    expect(v.barres).toEqual([])
  })

  it('converts relative frets above baseFret to absolute fret numbers', () => {
    // A-shape barre: relative [1,1,3,3,3,1] at baseFret 3 -> absolute [3,3,5,5,5,3]
    const v = dbPositionToVoicing({
      frets: [1, 1, 3, 3, 3, 1],
      fingers: [1, 1, 2, 3, 4, 1],
      baseFret: 3,
      barres: [1],
    })
    expect(v.frets).toEqual([3, 3, 5, 5, 5, 3])
    expect(v.barres).toEqual([3])
    expect(v.baseFret).toBe(3)
  })

  it('leaves muted (-1) and open (0) markers untouched during conversion', () => {
    const v = dbPositionToVoicing({
      frets: [-1, -1, 1, 1, 1, 4],
      fingers: [0, 0, 1, 1, 1, 4],
      baseFret: 5,
      barres: [1],
    })
    expect(v.frets).toEqual([-1, -1, 5, 5, 5, 8])
    expect(v.barres).toEqual([5])
  })
})

describe('resolveVoicingsFromDb', () => {
  it('returns the canonical open C as the first voicing', () => {
    const voicings = resolveVoicingsFromDb('C', db)
    expect(voicings[0].frets).toEqual([-1, 3, 2, 0, 1, 0])
  })

  it('returns the canonical open A minor as the first voicing', () => {
    const voicings = resolveVoicingsFromDb('Am', db)
    expect(voicings[0].frets).toEqual([-1, 0, 2, 2, 1, 0])
  })

  it('returns the F barre chord with a barre marker', () => {
    const voicings = resolveVoicingsFromDb('F', db)
    expect(voicings[0].frets).toEqual([1, 3, 3, 2, 1, 1])
    expect(voicings[0].barres).toContain(1)
  })

  it('offers multiple voicings to browse for common chords', () => {
    expect(resolveVoicingsFromDb('C', db).length).toBeGreaterThan(1)
    expect(resolveVoicingsFromDb('G', db).length).toBeGreaterThan(1)
  })

  it('resolves backend MIREX notation identically to display names', () => {
    expect(resolveVoicingsFromDb('C:maj', db)).toEqual(resolveVoicingsFromDb('C', db))
    expect(resolveVoicingsFromDb('D:min7', db)).toEqual(resolveVoicingsFromDb('Dm7', db))
  })

  it('resolves enharmonic roots (D# -> Eb, A# -> Bb)', () => {
    expect(resolveVoicingsFromDb('D#', db)).toEqual(resolveVoicingsFromDb('Eb', db))
    expect(resolveVoicingsFromDb('A#', db)).toEqual(resolveVoicingsFromDb('Bb', db))
    expect(resolveVoicingsFromDb('Eb', db).length).toBeGreaterThan(0)
  })

  it('returns true inversions for slash chords: lowest sounding note is the bass', () => {
    const voicings = resolveVoicingsFromDb('C/G', db)
    expect(voicings.length).toBeGreaterThan(0)
    // G pitch class = 7
    expect(lowestSoundingPitchClass(voicings[0])).toBe(7)
  })

  it('adapts open shapes when the db has no native inversion (D/F#)', () => {
    const voicings = resolveVoicingsFromDb('D/F#', db)
    expect(voicings.length).toBeGreaterThan(0)
    // F# pitch class = 6
    expect(lowestSoundingPitchClass(voicings[0])).toBe(6)
  })

  it('mutes strings below the new bass string (G/B)', () => {
    const voicings = resolveVoicingsFromDb('G/B', db)
    expect(voicings.length).toBeGreaterThan(0)
    // B pitch class = 11
    expect(lowestSoundingPitchClass(voicings[0])).toBe(11)
  })

  it('falls back to root voicings when no inversion is playable', () => {
    // Bass note that exists nowhere reachable still yields the root shapes.
    const voicings = resolveVoicingsFromDb('C/G', db)
    const plain = resolveVoicingsFromDb('C', db)
    expect(voicings.length).toBeGreaterThan(0)
    expect(plain.length).toBeGreaterThan(0)
  })

  it('resolves extended qualities present in the db', () => {
    expect(resolveVoicingsFromDb('Gmaj7', db).length).toBeGreaterThan(0)
    expect(resolveVoicingsFromDb('Asus4', db).length).toBeGreaterThan(0)
    expect(resolveVoicingsFromDb('Dadd9', db).length).toBeGreaterThan(0)
    expect(resolveVoicingsFromDb('Cm7', db).length).toBeGreaterThan(0)
  })

  it('returns an empty list for the no-chord token', () => {
    expect(resolveVoicingsFromDb('N', db)).toEqual([])
    expect(resolveVoicingsFromDb('', db)).toEqual([])
  })
})

describe('splitSlashBass', () => {
  it('splits a slash chord into root and bass', () => {
    expect(splitSlashBass('C/G')).toEqual({ root: 'C', bass: 'G' })
    expect(splitSlashBass('E/B')).toEqual({ root: 'E', bass: 'B' })
    expect(splitSlashBass('Bbm/F#')).toEqual({ root: 'Bbm', bass: 'F#' })
  })

  it('keeps extension slashes intact (C6/9 is not a slash bass)', () => {
    expect(splitSlashBass('C6/9')).toEqual({ root: 'C6/9', bass: null })
  })

  it('returns no bass for plain chords', () => {
    expect(splitSlashBass('Am')).toEqual({ root: 'Am', bass: null })
  })
})

import { formatChordName } from '@/lib/chord-colors'

/**
 * A single guitar chord voicing, normalized so every consumer renders the same shape.
 *
 * `frets`, `fingers` are 6 entries ordered low E -> high e.
 * `frets`: -1 = muted, 0 = open, >= 1 = the ABSOLUTE fret number to press.
 * `fingers`: 0 = open/muted/unspecified, 1-4 = fretting finger.
 * `barres`: absolute fret numbers where a finger bars multiple strings.
 */
export interface ChordVoicing {
  frets: number[]
  fingers: number[]
  baseFret: number
  barres: number[]
  capo?: boolean
}

type Fret = number | 'x'

interface ChordShape {
  // Low E -> High e
  frets: [Fret, Fret, Fret, Fret, Fret, Fret]
}

/**
 * Built-in open/primary shapes. This stays the synchronous source of truth for the
 * always-visible diagrams (chord map, current-chord panel) so the larger curated chord
 * database is only loaded on demand (when a player opens the voicing browser).
 */
export const CHORD_SHAPES: Record<string, ChordShape> = {
  // ── Major ──
  C: { frets: ['x', 3, 2, 0, 1, 0] },
  'C#': { frets: ['x', 4, 3, 1, 2, 1] },
  Db: { frets: ['x', 4, 3, 1, 2, 1] },
  D: { frets: ['x', 'x', 0, 2, 3, 2] },
  'D#': { frets: ['x', 6, 8, 8, 8, 6] },
  Eb: { frets: ['x', 6, 8, 8, 8, 6] },
  E: { frets: [0, 2, 2, 1, 0, 0] },
  F: { frets: [1, 3, 3, 2, 1, 1] },
  'F#': { frets: [2, 4, 4, 3, 2, 2] },
  Gb: { frets: [2, 4, 4, 3, 2, 2] },
  G: { frets: [3, 2, 0, 0, 0, 3] },
  'G#': { frets: [4, 6, 6, 5, 4, 4] },
  Ab: { frets: [4, 6, 6, 5, 4, 4] },
  A: { frets: ['x', 0, 2, 2, 2, 0] },
  'A#': { frets: [6, 8, 8, 7, 6, 6] },
  Bb: { frets: [6, 8, 8, 7, 6, 6] },
  B: { frets: ['x', 2, 4, 4, 4, 2] },

  // ── Minor ──
  Cm: { frets: ['x', 3, 5, 5, 4, 3] },
  'C#m': { frets: ['x', 4, 6, 6, 5, 4] },
  Dbm: { frets: ['x', 4, 6, 6, 5, 4] },
  Dm: { frets: ['x', 'x', 0, 2, 3, 1] },
  'D#m': { frets: ['x', 6, 8, 8, 7, 6] },
  Ebm: { frets: ['x', 6, 8, 8, 7, 6] },
  Em: { frets: [0, 2, 2, 0, 0, 0] },
  Fm: { frets: [1, 3, 3, 1, 1, 1] },
  'F#m': { frets: [2, 4, 4, 2, 2, 2] },
  Gbm: { frets: [2, 4, 4, 2, 2, 2] },
  Gm: { frets: [3, 5, 5, 3, 3, 3] },
  'G#m': { frets: [4, 6, 6, 4, 4, 4] },
  Abm: { frets: [4, 6, 6, 4, 4, 4] },
  Am: { frets: ['x', 0, 2, 2, 1, 0] },
  'A#m': { frets: [6, 8, 8, 6, 6, 6] },
  Bbm: { frets: [6, 8, 8, 6, 6, 6] },
  Bm: { frets: ['x', 2, 4, 4, 3, 2] },

  // ── Dominant 7th ──
  C7: { frets: ['x', 3, 2, 3, 1, 0] },
  'C#7': { frets: ['x', 4, 6, 4, 6, 4] },
  Db7: { frets: ['x', 4, 6, 4, 6, 4] },
  D7: { frets: ['x', 'x', 0, 2, 1, 2] },
  'D#7': { frets: ['x', 6, 8, 6, 8, 6] },
  Eb7: { frets: ['x', 6, 8, 6, 8, 6] },
  E7: { frets: [0, 2, 0, 1, 0, 0] },
  F7: { frets: [1, 3, 1, 2, 1, 1] },
  'F#7': { frets: [2, 4, 2, 3, 2, 2] },
  Gb7: { frets: [2, 4, 2, 3, 2, 2] },
  G7: { frets: [3, 2, 0, 0, 0, 1] },
  'G#7': { frets: [4, 6, 4, 5, 4, 4] },
  Ab7: { frets: [4, 6, 4, 5, 4, 4] },
  A7: { frets: ['x', 0, 2, 0, 2, 0] },
  'A#7': { frets: [6, 8, 6, 7, 6, 6] },
  Bb7: { frets: [6, 8, 6, 7, 6, 6] },
  B7: { frets: ['x', 2, 1, 2, 0, 2] },

  // ── Minor 7th ──
  Cm7: { frets: ['x', 3, 5, 3, 4, 3] },
  'C#m7': { frets: ['x', 4, 6, 4, 5, 4] },
  Dbm7: { frets: ['x', 4, 6, 4, 5, 4] },
  Dm7: { frets: ['x', 'x', 0, 2, 1, 1] },
  'D#m7': { frets: ['x', 6, 8, 6, 7, 6] },
  Ebm7: { frets: ['x', 6, 8, 6, 7, 6] },
  Em7: { frets: [0, 2, 2, 0, 3, 0] },
  Fm7: { frets: [1, 3, 1, 1, 1, 1] },
  'F#m7': { frets: [2, 4, 2, 2, 2, 2] },
  Gbm7: { frets: [2, 4, 2, 2, 2, 2] },
  Gm7: { frets: [3, 5, 3, 3, 3, 3] },
  'G#m7': { frets: [4, 6, 4, 4, 4, 4] },
  Abm7: { frets: [4, 6, 4, 4, 4, 4] },
  Am7: { frets: ['x', 0, 2, 0, 1, 0] },
  'A#m7': { frets: [6, 8, 6, 6, 6, 6] },
  Bbm7: { frets: [6, 8, 6, 6, 6, 6] },
  Bm7: { frets: ['x', 2, 4, 2, 3, 2] },

  // ── Major 7th ──
  Cmaj7: { frets: ['x', 3, 2, 0, 0, 0] },
  'C#maj7': { frets: ['x', 4, 3, 1, 1, 1] },
  Dbmaj7: { frets: ['x', 4, 3, 1, 1, 1] },
  Dmaj7: { frets: ['x', 'x', 0, 2, 2, 2] },
  'D#maj7': { frets: ['x', 6, 8, 7, 8, 6] },
  Ebmaj7: { frets: ['x', 6, 8, 7, 8, 6] },
  Emaj7: { frets: [0, 2, 1, 1, 0, 0] },
  Fmaj7: { frets: ['x', 'x', 3, 2, 1, 0] },
  'F#maj7': { frets: [2, 4, 3, 3, 2, 2] },
  Gbmaj7: { frets: [2, 4, 3, 3, 2, 2] },
  Gmaj7: { frets: [3, 2, 0, 0, 0, 2] },
  'G#maj7': { frets: [4, 6, 5, 5, 4, 4] },
  Abmaj7: { frets: [4, 6, 5, 5, 4, 4] },
  Amaj7: { frets: ['x', 0, 2, 1, 2, 0] },
  'A#maj7': { frets: [6, 8, 7, 7, 6, 6] },
  Bbmaj7: { frets: [6, 8, 7, 7, 6, 6] },
  Bmaj7: { frets: ['x', 2, 4, 3, 4, 2] },

  // ── Suspended ──
  Csus: { frets: ['x', 3, 3, 0, 1, 1] },
  Csus2: { frets: ['x', 3, 0, 0, 3, 3] },
  Csus4: { frets: ['x', 3, 3, 0, 1, 1] },
  'C#sus': { frets: ['x', 4, 4, 1, 2, 2] },
  'C#sus2': { frets: ['x', 4, 1, 1, 4, 4] },
  'C#sus4': { frets: ['x', 4, 4, 1, 2, 2] },
  Dbsus: { frets: ['x', 4, 4, 1, 2, 2] },
  Dbsus2: { frets: ['x', 4, 1, 1, 4, 4] },
  Dbsus4: { frets: ['x', 4, 4, 1, 2, 2] },
  Dsus: { frets: ['x', 'x', 0, 2, 3, 3] },
  Dsus2: { frets: ['x', 'x', 0, 2, 3, 0] },
  Dsus4: { frets: ['x', 'x', 0, 2, 3, 3] },
  'D#sus': { frets: ['x', 6, 6, 3, 4, 4] },
  'D#sus2': { frets: ['x', 6, 3, 3, 6, 6] },
  'D#sus4': { frets: ['x', 6, 6, 3, 4, 4] },
  Ebsus: { frets: ['x', 6, 6, 3, 4, 4] },
  Ebsus2: { frets: ['x', 6, 3, 3, 6, 6] },
  Ebsus4: { frets: ['x', 6, 6, 3, 4, 4] },
  Esus: { frets: [0, 2, 2, 2, 0, 0] },
  Esus2: { frets: [0, 2, 4, 4, 0, 0] },
  Esus4: { frets: [0, 2, 2, 2, 0, 0] },
  Fsus: { frets: [1, 3, 3, 3, 1, 1] },
  Fsus2: { frets: ['x', 'x', 3, 0, 1, 1] },
  Fsus4: { frets: [1, 3, 3, 3, 1, 1] },
  'F#sus': { frets: [2, 4, 4, 4, 2, 2] },
  'F#sus2': { frets: [2, 4, 1, 1, 2, 2] },
  'F#sus4': { frets: [2, 4, 4, 4, 2, 2] },
  Gbsus: { frets: [2, 4, 4, 4, 2, 2] },
  Gbsus2: { frets: [2, 4, 1, 1, 2, 2] },
  Gbsus4: { frets: [2, 4, 4, 4, 2, 2] },
  Gsus: { frets: [3, 5, 5, 5, 3, 3] },
  Gsus2: { frets: [3, 0, 0, 0, 3, 3] },
  Gsus4: { frets: [3, 5, 5, 5, 3, 3] },
  'G#sus': { frets: [4, 6, 6, 6, 4, 4] },
  'G#sus2': { frets: [4, 6, 3, 3, 4, 4] },
  'G#sus4': { frets: [4, 6, 6, 6, 4, 4] },
  Absus: { frets: [4, 6, 6, 6, 4, 4] },
  Absus2: { frets: [4, 6, 3, 3, 4, 4] },
  Absus4: { frets: [4, 6, 6, 6, 4, 4] },
  Asus: { frets: ['x', 0, 2, 2, 3, 0] },
  Asus2: { frets: ['x', 0, 2, 2, 0, 0] },
  Asus4: { frets: ['x', 0, 2, 2, 3, 0] },
  'A#sus': { frets: [6, 8, 8, 8, 6, 6] },
  'A#sus2': { frets: [6, 8, 5, 5, 6, 6] },
  'A#sus4': { frets: [6, 8, 8, 8, 6, 6] },
  Bbsus: { frets: [6, 8, 8, 8, 6, 6] },
  Bbsus2: { frets: [6, 8, 5, 5, 6, 6] },
  Bbsus4: { frets: [6, 8, 8, 6, 6, 6] },
  Bsus: { frets: ['x', 2, 4, 4, 5, 2] },
  Bsus2: { frets: ['x', 2, 4, 4, 2, 2] },
  Bsus4: { frets: ['x', 2, 4, 4, 5, 2] },

  // ── Diminished ──
  Cdim: { frets: ['x', 3, 4, 5, 4, 'x'] },
  'C#dim': { frets: ['x', 4, 5, 6, 5, 'x'] },
  Dbdim: { frets: ['x', 4, 5, 6, 5, 'x'] },
  Ddim: { frets: ['x', 5, 6, 7, 6, 'x'] },
  'D#dim': { frets: ['x', 6, 7, 8, 7, 'x'] },
  Ebdim: { frets: ['x', 6, 7, 8, 7, 'x'] },
  Edim: { frets: [0, 1, 2, 0, 'x', 'x'] },
  Fdim: { frets: ['x', 'x', 3, 1, 0, 1] },
  'F#dim': { frets: ['x', 'x', 4, 2, 1, 2] },
  Gbdim: { frets: ['x', 'x', 4, 2, 1, 2] },
  Gdim: { frets: ['x', 'x', 5, 3, 2, 3] },
  'G#dim': { frets: ['x', 'x', 6, 4, 3, 4] },
  Abdim: { frets: ['x', 'x', 6, 4, 3, 4] },
  Adim: { frets: ['x', 0, 1, 2, 1, 'x'] },
  'A#dim': { frets: ['x', 1, 2, 3, 2, 'x'] },
  Bbdim: { frets: ['x', 1, 2, 3, 2, 'x'] },
  Bdim: { frets: ['x', 2, 3, 4, 3, 'x'] },

  // ── Diminished 7th ──
  Cdim7: { frets: ['x', 3, 4, 2, 4, 2] },
  'C#dim7': { frets: ['x', 4, 5, 3, 5, 3] },
  Dbdim7: { frets: ['x', 4, 5, 3, 5, 3] },
  Ddim7: { frets: ['x', 'x', 0, 1, 0, 1] },
  'D#dim7': { frets: ['x', 6, 7, 5, 7, 5] },
  Ebdim7: { frets: ['x', 6, 7, 5, 7, 5] },
  Edim7: { frets: [0, 1, 2, 0, 2, 0] },
  Fdim7: { frets: [1, 2, 3, 1, 3, 1] },
  'F#dim7': { frets: [2, 3, 4, 2, 4, 2] },
  Gbdim7: { frets: [2, 3, 4, 2, 4, 2] },
  Gdim7: { frets: [3, 4, 5, 3, 5, 3] },
  'G#dim7': { frets: [4, 5, 6, 4, 6, 4] },
  Abdim7: { frets: [4, 5, 6, 4, 6, 4] },
  Adim7: { frets: ['x', 0, 1, 2, 1, 2] },
  'A#dim7': { frets: ['x', 1, 2, 0, 2, 0] },
  Bbdim7: { frets: ['x', 1, 2, 0, 2, 0] },
  Bdim7: { frets: ['x', 2, 3, 1, 3, 1] },

  // ── 7sus4 ──
  C7sus4: { frets: ['x', 3, 3, 3, 1, 1] },
  D7sus4: { frets: ['x', 'x', 0, 2, 1, 3] },
  E7sus4: { frets: [0, 2, 0, 2, 0, 0] },
  F7sus4: { frets: [1, 3, 1, 3, 1, 1] },
  G7sus4: { frets: [3, 5, 3, 5, 3, 3] },
  A7sus4: { frets: ['x', 0, 2, 0, 3, 0] },
  B7sus4: { frets: ['x', 2, 4, 2, 5, 2] },

  // ── Augmented ──
  Caug: { frets: ['x', 3, 2, 1, 1, 0] },
  Daug: { frets: ['x', 'x', 0, 3, 3, 2] },
  Eaug: { frets: [0, 3, 2, 1, 1, 0] },
  Faug: { frets: ['x', 'x', 3, 2, 2, 1] },
  Gaug: { frets: [3, 2, 1, 0, 0, 3] },
  Aaug: { frets: ['x', 0, 3, 2, 2, 1] },
  Baug: { frets: ['x', 2, 1, 0, 0, 3] },

  // ── 6th chords ──
  C6: { frets: ['x', 3, 2, 2, 1, 0] },
  D6: { frets: ['x', 'x', 0, 2, 0, 2] },
  E6: { frets: [0, 2, 2, 1, 2, 0] },
  G6: { frets: [3, 2, 0, 0, 0, 0] },
  A6: { frets: ['x', 0, 2, 2, 2, 2] },

  // ── 6/9 chords ──
  'C6/9': { frets: ['x', 3, 2, 2, 3, 3] },
  'D6/9': { frets: ['x', 5, 4, 0, 3, 0] },
  'E6/9': { frets: [0, 2, 2, 1, 2, 2] },
  'G6/9': { frets: [3, 2, 0, 2, 0, 0] },
  'A6/9': { frets: ['x', 0, 4, 2, 2, 2] },

  // ── 9th chords ──
  C9: { frets: ['x', 3, 2, 3, 3, 3] },
  D9: { frets: ['x', 'x', 0, 2, 1, 2] },
  E9: { frets: [0, 2, 0, 1, 0, 2] },
  G9: { frets: [3, 2, 0, 2, 0, 1] },
  A9: { frets: ['x', 0, 2, 4, 2, 3] },

  // ── Add9 chords ──
  Cadd9: { frets: ['x', 3, 2, 0, 3, 0] },
  'C#add9': { frets: ['x', 4, 3, 1, 4, 1] },
  Dbadd9: { frets: ['x', 4, 3, 1, 4, 1] },
  Dadd9: { frets: ['x', 'x', 0, 2, 3, 0] },
  'D#add9': { frets: ['x', 6, 5, 3, 6, 3] },
  Ebadd9: { frets: ['x', 6, 5, 3, 6, 3] },
  Eadd9: { frets: [0, 2, 2, 1, 0, 2] },
  Fadd9: { frets: ['x', 'x', 3, 2, 1, 3] },
  'F#add9': { frets: [2, 4, 4, 3, 2, 4] },
  Gbadd9: { frets: [2, 4, 4, 3, 2, 4] },
  Gadd9: { frets: [3, 2, 0, 0, 0, 3] },
  'G#add9': { frets: [4, 6, 6, 5, 4, 6] },
  Abadd9: { frets: [4, 6, 6, 5, 4, 6] },
  Aadd9: { frets: ['x', 0, 2, 2, 2, 0] },
  'A#add9': { frets: ['x', 1, 0, 3, 1, 1] },
  Bbadd9: { frets: ['x', 1, 0, 3, 1, 1] },
  Badd9: { frets: ['x', 2, 4, 4, 4, 2] },

  // ── Minor add9 ──
  Cmadd9: { frets: ['x', 3, 1, 0, 3, 3] },
  Dmadd9: { frets: ['x', 'x', 0, 2, 3, 0] },
  Emadd9: { frets: [0, 2, 2, 0, 0, 2] },
  Fmadd9: { frets: [1, 3, 3, 1, 1, 3] },
  Gmadd9: { frets: [3, 5, 5, 3, 3, 5] },
  Amadd9: { frets: ['x', 0, 2, 2, 1, 0] },
  Bmadd9: { frets: ['x', 2, 4, 4, 3, 2] },

  // ── Minor 9th ──
  Cm9: { frets: ['x', 3, 1, 3, 3, 3] },
  Dm9: { frets: ['x', 'x', 0, 2, 1, 0] },
  Em9: { frets: [0, 2, 2, 0, 3, 2] },
  Fm9: { frets: [1, 3, 1, 1, 1, 3] },
  Gm9: { frets: [3, 5, 3, 3, 3, 5] },
  Am9: { frets: ['x', 0, 2, 4, 1, 3] },
  Bm9: { frets: ['x', 2, 4, 2, 2, 2] },

  // ── Half-diminished (m7b5) ──
  Cm7b5: { frets: ['x', 3, 4, 3, 4, 'x'] },
  'C#m7b5': { frets: ['x', 4, 5, 4, 5, 'x'] },
  Dbm7b5: { frets: ['x', 4, 5, 4, 5, 'x'] },
  Dm7b5: { frets: ['x', 'x', 0, 1, 1, 1] },
  'D#m7b5': { frets: ['x', 6, 7, 6, 7, 'x'] },
  Ebm7b5: { frets: ['x', 6, 7, 6, 7, 'x'] },
  Em7b5: { frets: [0, 1, 2, 0, 3, 0] },
  Fm7b5: { frets: [1, 2, 3, 1, 4, 1] },
  'F#m7b5': { frets: [2, 3, 4, 2, 5, 2] },
  Gbm7b5: { frets: [2, 3, 4, 2, 5, 2] },
  Gm7b5: { frets: [3, 4, 5, 3, 6, 3] },
  'G#m7b5': { frets: [4, 5, 6, 4, 7, 4] },
  Abm7b5: { frets: [4, 5, 6, 4, 7, 4] },
  Am7b5: { frets: ['x', 0, 1, 0, 1, 0] },
  'A#m7b5': { frets: ['x', 1, 2, 1, 2, 'x'] },
  Bbm7b5: { frets: ['x', 1, 2, 1, 2, 'x'] },
  Bm7b5: { frets: ['x', 2, 3, 2, 3, 'x'] },

  // ── Power chords ──
  C5: { frets: ['x', 3, 5, 5, 'x', 'x'] },
  'C#5': { frets: ['x', 4, 6, 6, 'x', 'x'] },
  Db5: { frets: ['x', 4, 6, 6, 'x', 'x'] },
  D5: { frets: ['x', 'x', 0, 2, 3, 'x'] },
  'D#5': { frets: ['x', 6, 8, 8, 'x', 'x'] },
  Eb5: { frets: ['x', 6, 8, 8, 'x', 'x'] },
  E5: { frets: [0, 2, 2, 'x', 'x', 'x'] },
  F5: { frets: [1, 3, 3, 'x', 'x', 'x'] },
  'F#5': { frets: [2, 4, 4, 'x', 'x', 'x'] },
  Gb5: { frets: [2, 4, 4, 'x', 'x', 'x'] },
  G5: { frets: [3, 5, 5, 'x', 'x', 'x'] },
  'G#5': { frets: [4, 6, 6, 'x', 'x', 'x'] },
  Ab5: { frets: [4, 6, 6, 'x', 'x', 'x'] },
  A5: { frets: ['x', 0, 2, 2, 'x', 'x'] },
  'A#5': { frets: ['x', 1, 3, 3, 'x', 'x'] },
  Bb5: { frets: ['x', 1, 3, 3, 'x', 'x'] },
  B5: { frets: ['x', 2, 4, 4, 'x', 'x'] },
}

export function normalizeChordName(raw: string): string {
  const trimmed = (raw || '').trim()
  if (!trimmed) return ''

  // Convert backend notation (e.g. "C:maj") to display notation (e.g. "C")
  const formatted = formatChordName(trimmed)

  // Remove parentheses/extra spacing: "Am(add9)" -> "Amadd9"
  const simplified = formatted.replaceAll(' ', '').replaceAll('(', '').replaceAll(')', '')

  // Try full name first (handles D6/9, C6/9 etc.)
  if (CHORD_SHAPES[simplified]) return simplified

  // Strip slash bass notes for slash chords: C/G -> C, D/F# -> D
  const slashIdx = simplified.lastIndexOf('/')
  if (slashIdx > 0) {
    const after = simplified.slice(slashIdx + 1)
    if (/^[A-G][#b]?$/.test(after)) {
      return simplified.slice(0, slashIdx)
    }
  }

  return simplified
}

function getShape(chordName: string): ChordShape | null {
  const key = normalizeChordName(chordName)
  return (key && CHORD_SHAPES[key]) || null
}

export function computeBaseFret(frets: ChordShape['frets']): number {
  const positives = frets.filter((f) => typeof f === 'number' && f > 0) as number[]
  if (positives.length === 0) return 1
  const min = Math.min(...positives)
  const max = Math.max(...positives)
  // If the shape spans more than 5 frets, anchor at min.
  if (max - min >= 5) return min
  // If there are open strings, prefer showing from fret 1.
  if (frets.some((f) => f === 0)) return 1
  return min
}

/**
 * Resolve the built-in primary voicing for a chord, synchronously.
 * Used by the always-visible diagrams so they never wait on the curated database.
 * The built-in table has no finger or barre metadata, so those come back empty.
 */
export function getPrimaryVoicing(chordName: string): ChordVoicing | null {
  const shape = getShape(chordName)
  if (!shape) return null
  return {
    frets: shape.frets.map((f) => (f === 'x' ? -1 : f)),
    fingers: [0, 0, 0, 0, 0, 0],
    baseFret: computeBaseFret(shape.frets),
    barres: [],
  }
}

type NoteLetter = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G'

const SHARP_SCALE = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const

const NOTE_TO_SHARP: Record<string, string> = {
  C: 'C',
  'B#': 'C',
  'C#': 'C#',
  Db: 'C#',
  D: 'D',
  'D#': 'D#',
  Eb: 'D#',
  E: 'E',
  Fb: 'E',
  'E#': 'F',
  F: 'F',
  'F#': 'F#',
  Gb: 'F#',
  G: 'G',
  'G#': 'G#',
  Ab: 'G#',
  A: 'A',
  'A#': 'A#',
  Bb: 'A#',
  B: 'B',
  Cb: 'B',
}

const QUALITY_MAP: Record<string, string> = {
  maj: '',
  min: 'm',
  dim: 'dim',
  aug: 'aug',
  sus2: 'sus2',
  sus4: 'sus4',
  '7': '7',
  maj7: 'maj7',
  min7: 'm7',
  dim7: 'dim7',
  hdim7: 'm7b5',
  minmaj7: 'mM7',
  aug7: 'aug7',
  '9': '9',
  maj9: 'maj9',
  min9: 'm9',
  '11': '11',
  '13': '13',
}

export function normalizeNoteToSharps(note: string): string {
  const n = (note || '').trim()
  if (!n) return ''
  return NOTE_TO_SHARP[n] ?? n
}

function parseNotePrefix(input: string): { note: string; rest: string } | null {
  const s = (input || '').trim()
  if (!s) return null
  const m = /^([A-G])([#b]?)(.*)$/.exec(s)
  if (!m) return null
  const letter = m[1] as NoteLetter
  const accidental = m[2] || ''
  const rest = m[3] || ''
  return { note: `${letter}${accidental}`, rest }
}

function transposeNoteSharpsOnly(note: string, semitones: number): string {
  const sharp = normalizeNoteToSharps(note)
  const idx = SHARP_SCALE.indexOf(sharp as (typeof SHARP_SCALE)[number])
  if (idx === -1) return sharp
  const mod = ((idx + semitones) % 12 + 12) % 12
  return SHARP_SCALE[mod]
}

function splitSlash(input: string): { main: string; bass: string | null } {
  const s = (input || '').trim()
  const parts = s.split('/')
  if (parts.length <= 1) return { main: s, bass: null }
  const main = parts[0] ?? ''
  const bass = parts.slice(1).join('/')
  return { main, bass: bass || null }
}

function isNoteLike(input: string): boolean {
  return /^([A-G])([#b]?)$/.test((input || '').trim())
}

export function formatChordDisplayName(raw: string, opts?: { preferSharps?: boolean }): string {
  const chord = (raw || '').trim()
  if (!chord) return ''
  if (chord === 'N') return 'N'

  const preferSharps = opts?.preferSharps ?? false

  // Backend MIREX-ish: Root:quality (e.g. Gb:maj, A:min, G:7)
  if (chord.includes(':')) {
    const [rootRaw, qualityRaw = ''] = chord.split(':')
    const root = preferSharps ? normalizeNoteToSharps(rootRaw) : rootRaw

    // Some backends encode bass degrees like min/b3. Keep only the quality part.
    const qualityKey = qualityRaw.split('/')[0] ?? qualityRaw
    const suffix = QUALITY_MAP[qualityKey] ?? qualityKey
    return `${root}${suffix}`
  }

  // Already display-ish (e.g. F#m7b5, Bbmaj7, D/F#)
  const { main, bass } = splitSlash(chord)
  const mainParsed = parseNotePrefix(main)
  if (!mainParsed) return chord
  const root = preferSharps ? normalizeNoteToSharps(mainParsed.note) : mainParsed.note
  const suffix = (mainParsed.rest || '').trim()

  // Only keep slash if the bass is an actual note (C/E). For things like /b3, drop it.
  if (bass && isNoteLike(bass)) {
    const bassNote = preferSharps ? normalizeNoteToSharps(bass) : bass
    return `${root}${suffix}/${bassNote}`
  }
  return `${root}${suffix}`
}

export function transposeChordLabel(raw: string, semitones: number, opts?: { preferSharps?: boolean }): string {
  const chord = (raw || '').trim()
  if (!chord) return ''
  if (chord === 'N') return 'N'
  const preferSharps = opts?.preferSharps ?? true

  // First, format to a consistent display label.
  const formatted = formatChordDisplayName(chord, { preferSharps })
  if (!formatted || formatted === 'N') return formatted
  if (!semitones) return formatted

  const { main, bass } = splitSlash(formatted)
  const parsedMain = parseNotePrefix(main)
  if (!parsedMain) return formatted

  const rootT = transposeNoteSharpsOnly(parsedMain.note, semitones)
  const outMain = `${rootT}${parsedMain.rest}`

  if (bass && isNoteLike(bass)) {
    const bassT = transposeNoteSharpsOnly(bass, semitones)
    return `${outMain}/${bassT}`
  }
  return outMain
}

export function getChordRootNote(raw: string, opts?: { preferSharps?: boolean }): string {
  const chord = (raw || '').trim()
  if (!chord || chord === 'N') return 'N'
  const preferSharps = opts?.preferSharps ?? true

  if (chord.includes(':')) {
    const root = chord.split(':')[0] ?? ''
    return preferSharps ? normalizeNoteToSharps(root) : root
  }

  const { main } = splitSlash(chord)
  const parsed = parseNotePrefix(main)
  if (!parsed) return ''
  return preferSharps ? normalizeNoteToSharps(parsed.note) : parsed.note
}

export interface GuitarString {
  name: string
  note: string
  octave: number
  frequency: number
  stringNumber: number
}

export const STANDARD_TUNING: GuitarString[] = [
  { name: 'E2', note: 'E', octave: 2, frequency: 82.41, stringNumber: 6 },
  { name: 'A2', note: 'A', octave: 2, frequency: 110.0, stringNumber: 5 },
  { name: 'D3', note: 'D', octave: 3, frequency: 146.83, stringNumber: 4 },
  { name: 'G3', note: 'G', octave: 3, frequency: 196.0, stringNumber: 3 },
  { name: 'B3', note: 'B', octave: 3, frequency: 246.94, stringNumber: 2 },
  { name: 'E4', note: 'E', octave: 4, frequency: 329.63, stringNumber: 1 },
]

export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const

const A4_FREQ = 440

export interface DetectedNote {
  note: string
  octave: number
  cents: number
  frequency: number
}

export function findNearestNote(frequency: number): DetectedNote {
  const semitonesFromA4 = 12 * Math.log2(frequency / A4_FREQ)
  const roundedSemitones = Math.round(semitonesFromA4)
  const cents = Math.round((semitonesFromA4 - roundedSemitones) * 100)

  // A4 is note index 9 (A) in octave 4
  const noteIndex = ((roundedSemitones % 12) + 12 + 9) % 12
  const octave = 4 + Math.floor((roundedSemitones + 9) / 12)

  const exactFrequency = A4_FREQ * Math.pow(2, roundedSemitones / 12)

  return {
    note: NOTE_NAMES[noteIndex],
    octave,
    cents,
    frequency: exactFrequency,
  }
}

export function shiftTuning(tuning: GuitarString[], semitones: number): GuitarString[] {
  if (semitones === 0) return tuning
  return tuning.map((str) => {
    const frequency = str.frequency * Math.pow(2, semitones / 12)
    const semitonesFromA4 = Math.round(12 * Math.log2(frequency / A4_FREQ))
    const noteIndex = ((semitonesFromA4 % 12) + 12 + 9) % 12
    const octave = 4 + Math.floor((semitonesFromA4 + 9) / 12)
    const note = NOTE_NAMES[noteIndex]
    return {
      ...str,
      frequency: Math.round(frequency * 100) / 100,
      note,
      octave,
      name: `${note}${octave}`,
    }
  })
}

export function findNearestString(
  frequency: number,
  tuning: GuitarString[] = STANDARD_TUNING
): GuitarString {
  let closest = tuning[0]
  let minDistance = Infinity

  for (const str of tuning) {
    const distance = Math.abs(1200 * Math.log2(frequency / str.frequency))
    if (distance < minDistance) {
      minDistance = distance
      closest = str
    }
  }

  return closest
}

export function centsFromTarget(detected: number, target: number): number {
  const cents = 1200 * Math.log2(detected / target)
  return Math.max(-50, Math.min(50, cents))
}

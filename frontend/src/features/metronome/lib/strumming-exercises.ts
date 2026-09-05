export type StrumAction = 'rest' | 'play' | 'accent'
export type PracticeLevel = 'easy' | 'medium' | 'hard'

export interface StrummingExercise {
  id: string
  name: string
  description: string
  beatsPerBar: number
  beatUnit: number
  steps: StrumAction[]
  bpm?: number
  custom?: boolean
}

const COMMON_EXERCISE_TEMPOS: Record<string, number> = {
  'quarter-note-downstrokes': 80,
  'straight-eighth-notes': 100,
  'pop-d-d-u-u-d-u': 92,
  'folk-variation': 88,
  'reggae-offbeats': 80,
  'driving-eighths': 120,
  'country-train': 110,
  'rock-backbeat': 108,
  'accent-two-four': 90,
  'two-beat-downstrokes': 90,
  'two-beat-eighths': 110,
  'waltz-downstrokes': 80,
  'flowing-waltz-eighths': 100,
  'bass-brush-waltz': 90,
  'six-eight-pulse': 72,
  'flowing-six-eight': 96,
  'six-eight-ballad': 84,
}

const LEVEL_TEMPO_OFFSETS: Record<PracticeLevel, number> = {
  easy: -20,
  medium: 0,
  hard: 20,
}

function commonExercise(exercise: StrummingExercise): StrummingExercise {
  const bpm = COMMON_EXERCISE_TEMPOS[exercise.id]
  if (!bpm) throw new Error(`Missing tempo for common exercise: ${exercise.id}`)
  return Object.freeze({
    ...exercise,
    bpm,
    steps: Object.freeze([...exercise.steps]) as StrumAction[],
  }) as StrummingExercise
}

export function practiceTempo(exercise: StrummingExercise, level: PracticeLevel): number {
  const mediumTempo = exercise.bpm ?? 120
  return Math.max(40, Math.min(240, mediumTempo + LEVEL_TEMPO_OFFSETS[level]))
}

export const COMMON_STRUMMING_EXERCISES = Object.freeze([
  commonExercise({
    id: 'quarter-note-downstrokes',
    name: 'Quarter-note downstrokes',
    description: 'Accent beat 1; emphasize each steady downstroke.',
    beatsPerBar: 4,
    beatUnit: 4,
    steps: ['accent', 'rest', 'play', 'rest', 'play', 'rest', 'play', 'rest'],
  }),
  commonExercise({
    id: 'straight-eighth-notes',
    name: 'Straight eighth notes',
    description: 'Accent beat 1, then keep every down and up stroke even.',
    beatsPerBar: 4,
    beatUnit: 4,
    steps: ['accent', 'play', 'play', 'play', 'play', 'play', 'play', 'play'],
  }),
  commonExercise({
    id: 'pop-d-d-u-u-d-u',
    name: 'Common pop: D D U U D U',
    description: 'Accent the downstrokes on beats 1 and 4.',
    beatsPerBar: 4,
    beatUnit: 4,
    steps: ['accent', 'rest', 'play', 'play', 'rest', 'play', 'accent', 'play'],
  }),
  commonExercise({
    id: 'folk-variation',
    name: 'Folk variation',
    description: 'Accent beat 1 and lean into the downstroke on beat 3.',
    beatsPerBar: 4,
    beatUnit: 4,
    steps: ['accent', 'rest', 'play', 'play', 'accent', 'rest', 'play', 'play'],
  }),
  commonExercise({
    id: 'reggae-offbeats',
    name: 'Reggae offbeats',
    description: 'Skip the downbeats and accent every upbeat.',
    beatsPerBar: 4,
    beatUnit: 4,
    steps: ['rest', 'accent', 'rest', 'accent', 'rest', 'accent', 'rest', 'accent'],
  }),
  commonExercise({
    id: 'driving-eighths',
    name: 'Driving eighths',
    description: 'Play every stroke and accent beats 1 and 3.',
    beatsPerBar: 4,
    beatUnit: 4,
    steps: ['accent', 'play', 'play', 'play', 'accent', 'play', 'play', 'play'],
  }),
  commonExercise({
    id: 'country-train',
    name: 'Country train',
    description: 'Accent beats 1 and 3; let the upstrokes drive the groove.',
    beatsPerBar: 4,
    beatUnit: 4,
    steps: ['accent', 'play', 'rest', 'play', 'accent', 'play', 'rest', 'play'],
  }),
  commonExercise({
    id: 'rock-backbeat',
    name: 'Rock backbeat',
    description: 'Lean into the upstrokes after beats 2 and 4.',
    beatsPerBar: 4,
    beatUnit: 4,
    steps: ['play', 'rest', 'play', 'accent', 'play', 'rest', 'play', 'accent'],
  }),
  commonExercise({
    id: 'accent-two-four',
    name: 'Accent 2 and 4 drill',
    description: 'Use steady downstrokes and emphasize beats 2 and 4.',
    beatsPerBar: 4,
    beatUnit: 4,
    steps: ['play', 'rest', 'accent', 'rest', 'play', 'rest', 'accent', 'rest'],
  }),
  commonExercise({
    id: 'two-beat-downstrokes',
    name: 'Two-beat downstrokes',
    description: 'Accent beat 1 and keep both downstrokes steady.',
    beatsPerBar: 2,
    beatUnit: 4,
    steps: ['accent', 'rest', 'play', 'rest'],
  }),
  commonExercise({
    id: 'two-beat-eighths',
    name: 'Two-beat eighths',
    description: 'Play all four strokes with a strong beat 1.',
    beatsPerBar: 2,
    beatUnit: 4,
    steps: ['accent', 'play', 'play', 'play'],
  }),
  commonExercise({
    id: 'waltz-downstrokes',
    name: 'Waltz downstrokes',
    description: 'Accent beat 1, then emphasize the grounded downbeats.',
    beatsPerBar: 3,
    beatUnit: 4,
    steps: ['accent', 'rest', 'play', 'rest', 'play', 'rest'],
  }),
  commonExercise({
    id: 'flowing-waltz-eighths',
    name: 'Flowing waltz eighths',
    description: 'Accent beat 1 and keep all six strokes flowing.',
    beatsPerBar: 3,
    beatUnit: 4,
    steps: ['accent', 'play', 'play', 'play', 'play', 'play'],
  }),
  commonExercise({
    id: 'bass-brush-waltz',
    name: 'Bass-and-brush waltz',
    description: 'Ground beat 1, then use flowing brushes on beats 2 and 3.',
    beatsPerBar: 3,
    beatUnit: 4,
    steps: ['accent', 'rest', 'play', 'play', 'play', 'play'],
  }),
  commonExercise({
    id: 'six-eight-pulse',
    name: '6/8 pulse',
    description: 'Accent beats 1 and 4 to feel the two large pulses.',
    beatsPerBar: 6,
    beatUnit: 8,
    steps: ['accent', 'rest', 'play', 'rest', 'play', 'rest', 'accent', 'rest', 'play', 'rest', 'play', 'rest'],
  }),
  commonExercise({
    id: 'flowing-six-eight',
    name: 'Flowing 6/8',
    description: 'Play continuously and accent beats 1 and 4.',
    beatsPerBar: 6,
    beatUnit: 8,
    steps: ['accent', 'play', 'play', 'play', 'play', 'play', 'accent', 'play', 'play', 'play', 'play', 'play'],
  }),
  commonExercise({
    id: 'six-eight-ballad',
    name: '6/8 ballad',
    description: 'Accent beats 1 and 4 with a light lift before each pulse.',
    beatsPerBar: 6,
    beatUnit: 8,
    steps: ['accent', 'rest', 'play', 'play', 'play', 'rest', 'accent', 'rest', 'play', 'play', 'play', 'rest'],
  }),
] as StrummingExercise[])

export function createPracticeSteps(beatsPerBar: number): StrumAction[] {
  return Array.from({ length: beatsPerBar * 2 }, (_, index) => {
    if (index === 0) return 'accent'
    return index % 2 === 0 ? 'play' : 'rest'
  })
}

export function createRandomSteps(beatsPerBar: number): StrumAction[] {
  return Array.from({ length: beatsPerBar * 2 }, (_, index) => {
    if (index === 0) return 'accent'
    const chance = Math.random()
    if (chance < 0.15) return 'accent'
    return chance < 0.65 ? 'play' : 'rest'
  })
}

export type StrumAction = 'rest' | 'play' | 'accent'

export interface StrummingExercise {
  id: string
  name: string
  description: string
  beatsPerBar: number
  beatUnit: number
  steps: StrumAction[]
  custom?: boolean
}

function commonExercise(exercise: StrummingExercise): StrummingExercise {
  return Object.freeze({
    ...exercise,
    steps: Object.freeze([...exercise.steps]) as StrumAction[],
  }) as StrummingExercise
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
] as StrummingExercise[])

export function createPracticeSteps(beatsPerBar: number): StrumAction[] {
  return Array.from({ length: beatsPerBar * 2 }, (_, index) => {
    if (index === 0) return 'accent'
    return index % 2 === 0 ? 'play' : 'rest'
  })
}

export function createRandomExercise(beatsPerBar: number, beatUnit: number): StrummingExercise {
  const steps = Array.from({ length: beatsPerBar * 2 }, (_, index) => {
    if (index === 0) return 'accent'
    return Math.random() < 0.6 ? 'play' : 'rest'
  })

  return {
    id: 'generated',
    name: 'Fresh pattern',
    description: 'A fresh groove with an accented beat-one downstroke.',
    beatsPerBar,
    beatUnit,
    steps,
  }
}

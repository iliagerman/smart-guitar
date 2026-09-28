import type { PracticeProgress, PracticeStep, SkillLevel } from '@/types/practice'

export interface PracticeStepInfo {
  step: PracticeStep
  title: string
  /** Label for the compact stepper. */
  short: string
  /** One-line instruction shown while the step is active. */
  instruction: string
  /** Label of the button that finishes the step. */
  doneLabel: string
  pro: boolean
}

export const PRACTICE_STEPS: readonly PracticeStepInfo[] = [
  {
    step: 1,
    title: 'Hear it',
    short: 'Hear it',
    instruction: 'Only the guitarist is playing. Listen to the part a couple of times.',
    doneLabel: 'I can hear it → learn it',
    pro: false,
  },
  {
    step: 2,
    title: 'Learn it',
    short: 'Learn it',
    instruction: 'Easy shapes, guitar only, 75% speed, verse on loop. Tick each shape you can play.',
    doneLabel: 'I’ve got these → go on stage',
    pro: false,
  },
  {
    step: 3,
    title: 'Play it with the band',
    short: 'On stage',
    instruction: 'The real recording without its guitar, at 75%. You’re the guitarist.',
    doneLabel: 'Nailed it → full speed',
    pro: true,
  },
  {
    step: 4,
    title: 'Full speed',
    short: 'Full speed',
    instruction: 'The whole band at full speed. Record yourself and hear how you sound.',
    doneLabel: 'Song complete',
    pro: true,
  },
] as const

export const ALL_STEPS: readonly PracticeStep[] = [1, 2, 3, 4]

/** Fraction of a step-3/4 play-through that counts as "played it through". */
export const STAGE_DONE_FRACTION = 0.9

export const SKILL_LEVELS: readonly { level: SkillLevel; label: string }[] = [
  { level: 'beginner', label: 'Never played' },
  { level: 'intermediate', label: 'Know a few chords' },
  { level: 'advanced', label: 'Play in a band' },
]

export function stepInfo(step: PracticeStep): PracticeStepInfo {
  return PRACTICE_STEPS[step - 1]
}

export function emptyProgress(songId: string): PracticeProgress {
  return {
    song_id: songId,
    current_step: 1,
    completed_steps: [],
    learned_chords: [],
    stage_progress: 0,
    last_practiced_at: null,
  }
}

/** Marks `step` done and moves on to the next unfinished step. */
export function completeStep(progress: PracticeProgress, step: PracticeStep): PracticeProgress {
  const completed = ALL_STEPS.filter((s) => s === step || progress.completed_steps.includes(s))
  const next = ALL_STEPS.find((s) => s > step && !completed.includes(s)) ?? step
  return { ...progress, completed_steps: completed, current_step: next }
}

/** Toggles a chord shape in the learned list, keeping the song's shape order. */
export function toggleLearnedChord(
  progress: PracticeProgress,
  chord: string,
  songShapes: readonly string[],
): PracticeProgress {
  const learned = new Set(progress.learned_chords)
  if (learned.has(chord)) learned.delete(chord)
  else learned.add(chord)
  return { ...progress, learned_chords: songShapes.filter((c) => learned.has(c)) }
}

/**
 * Unique chord names in order of first appearance, ignoring "no chord" markers
 * and chords that only flash by (< 3% of the chord time) — detector noise.
 */
export function songShapes(chords: readonly { chord: string; start_time: number; end_time: number }[]): string[] {
  const durations = new Map<string, number>()
  let total = 0
  for (const c of chords) {
    if (!c.chord || c.chord === 'N' || c.chord === 'X') continue
    const d = Math.max(0, c.end_time - c.start_time)
    durations.set(c.chord, (durations.get(c.chord) ?? 0) + d)
    total += d
  }
  return [...durations.keys()].filter((name) => (durations.get(name) ?? 0) >= total * 0.03)
}

/**
 * The first verse to loop while learning: from the first sung line through the
 * next few lines, capped to ~30s so the loop stays short enough to repeat.
 */
export function firstVerseLoop(
  lyrics: readonly { start: number; end: number }[],
): { start: number; end: number } | null {
  if (lyrics.length === 0) return null
  const start = lyrics[0].start
  let end = lyrics[0].end
  for (const line of lyrics.slice(1, 4)) {
    if (line.end - start > 30) break
    end = line.end
  }
  return end - start >= 4 ? { start, end } : null
}

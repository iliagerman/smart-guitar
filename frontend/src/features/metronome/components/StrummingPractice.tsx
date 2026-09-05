import { useEffect, useState, type FormEvent } from 'react'
import { Dice5, PencilLine, Trash2 } from 'lucide-react'
import { cn } from '@/lib/cn'
import {
  COMMON_STRUMMING_EXERCISES,
  createPracticeSteps,
  createRandomSteps,
  practiceTempo,
  type PracticeLevel,
  type StrumAction,
  type StrummingExercise,
} from '../lib/strumming-exercises'
import { useStrummingExercisesStore } from '@/stores/strumming-exercises.store'
import { useScreenWakeLock, type ScreenWakeLockStatus } from '../hooks/use-screen-wake-lock'

interface StrummingPracticeProps {
  bpm: number
  beatsPerBar: number
  beatUnit: number
  enabled: boolean
  subdivision: number
  onBpmChange: (value: number) => void
}

interface PatternGridProps {
  steps: StrumAction[]
  enabled: boolean
  subdivision: number
}

interface PracticeStepProps {
  index: number
  action: StrumAction
  active: boolean
}

interface ExerciseComposerProps {
  beatsPerBar: number
  beatUnit: number
  name: string
  tempo: number
  steps: StrumAction[]
  onNameChange: (name: string) => void
  onTempoChange: (tempo: number) => void
  onPlayToggle: (index: number) => void
  onAccentToggle: (index: number) => void
  onSave: (event: FormEvent<HTMLFormElement>) => void
  onClose: () => void
}

interface DraftStepControlProps {
  index: number
  action: StrumAction
  onPlayToggle: (index: number) => void
  onAccentToggle: (index: number) => void
}

interface TempoControlProps {
  tempo: number
  onTempoChange: (tempo: number) => void
}

interface PracticeControlsProps {
  onInvent: () => void
  onCompose: () => void
}

interface ExerciseSelectProps {
  exercises: StrummingExercise[]
  selectedExercise: StrummingExercise | undefined
  onSelect: (id: string) => void
}

interface PracticeLevelSelectProps {
  level: PracticeLevel
  onChange: (level: PracticeLevel) => void
}

interface SelectedExerciseProps {
  exercise: StrummingExercise
  level: PracticeLevel
  enabled: boolean
  subdivision: number
  onDelete: (id: string) => void
}

interface ScreenAwakeStatusProps {
  status: ScreenWakeLockStatus
}

const focusRing = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-flame-400/40'
const PRACTICE_LEVEL_OPTIONS: Array<{ value: PracticeLevel; label: string }> = [
  { value: 'easy', label: 'Easy · slower' },
  { value: 'medium', label: 'Medium · standard' },
  { value: 'hard', label: 'Hard · faster' },
]
const wakeLockMessages: Record<ScreenWakeLockStatus, string> = {
  idle: 'Screen wake lock starts with the metronome.',
  requesting: 'Keeping the screen awake…',
  active: 'Screen will stay awake while you practice.',
  unavailable: 'Screen wake lock is unavailable. Check your device sleep settings.',
}

function slotLabel(index: number): string {
  return index % 2 === 0 ? String(index / 2 + 1) : '&'
}

function actionLabel(action: StrumAction): string {
  if (action === 'accent') return 'Accent'
  if (action === 'play') return 'Strum'
  return 'Skip'
}

function PracticeStep({ index, action, active }: PracticeStepProps) {
  const downstroke = index % 2 === 0
  const direction = downstroke ? 'down' : 'up'

  return (
    <div
      className={cn(
        'min-h-28 rounded-xl border p-3 text-center transition-colors motion-reduce:transition-none',
        active ? 'border-flame-300 bg-flame-400/15 ring-2 ring-flame-300 ring-offset-2 ring-offset-charcoal-950' : 'border-white/10 bg-charcoal-900/50',
        action === 'rest' && !active && 'opacity-45',
        action === 'accent' && 'border-sky-400/70 bg-sky-400/15',
      )}
      data-metronome-tick={downstroke ? 'true' : undefined}
      data-strum-action={action}
      data-testid={`strum-step-${index}`}
    >
      <div className="text-xs font-semibold text-smoke-400">{slotLabel(index)}</div>
      <div className={cn('mt-1 text-3xl font-bold leading-none', downstroke ? 'text-emerald-400' : 'text-amber-300')}>
        {downstroke ? '↓' : '↑'}
      </div>
      <div className={cn('mt-2 text-xs font-semibold uppercase tracking-wide', action === 'accent' ? 'text-sky-200' : 'text-smoke-200')}>{actionLabel(action)}</div>
      <div className="mt-1 text-[10px] uppercase tracking-wide text-smoke-500">{direction}</div>
    </div>
  )
}

function PatternGrid({ steps, enabled, subdivision }: PatternGridProps) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
      {steps.map((action, index) => (
        <PracticeStep key={index} index={index} action={action} active={enabled && subdivision === index} />
      ))}
    </div>
  )
}

function DraftStepControl({ index, action, onPlayToggle, onAccentToggle }: DraftStepControlProps) {
  const downstroke = index % 2 === 0
  const played = action !== 'rest'
  const accented = action === 'accent'
  return (
    <div className="rounded-lg border border-charcoal-600 bg-charcoal-950/60 p-2" data-testid={`custom-strum-step-${index}`}>
      <div className="text-center text-sm font-bold text-smoke-200">{downstroke ? '↓' : '↑'} {slotLabel(index)}</div>
      <button
        type="button"
        onClick={() => onPlayToggle(index)}
        className={cn('mt-2 min-h-11 w-full touch-manipulation rounded-md border px-2 text-xs font-semibold transition-colors hover:border-emerald-300/70 motion-reduce:transition-none', played ? 'border-emerald-400/60 bg-emerald-400/15 text-emerald-200' : 'border-charcoal-600 bg-charcoal-800 text-smoke-400', focusRing)}
        aria-label={`${played ? 'Skip' : 'Play'} ${slotLabel(index)} ${downstroke ? 'downstroke' : 'upstroke'}`}
        aria-pressed={played}
        data-testid={`custom-strum-play-${index}`}
      >
        {played ? 'Played' : 'Skipped'}
      </button>
      <button
        type="button"
        onClick={() => onAccentToggle(index)}
        disabled={!played}
        className={cn('mt-1 min-h-11 w-full touch-manipulation rounded-md border px-2 text-xs font-semibold transition-colors hover:border-sky-300/70 disabled:cursor-not-allowed disabled:opacity-35 motion-reduce:transition-none', accented ? 'border-sky-400/70 bg-sky-400/15 text-sky-200' : 'border-charcoal-600 bg-charcoal-800 text-smoke-400', focusRing)}
        aria-label={`${accented ? 'Remove accent from' : 'Accent'} ${slotLabel(index)} ${downstroke ? 'downstroke' : 'upstroke'}`}
        aria-pressed={accented}
        data-testid={`custom-strum-accent-${index}`}
      >
        {accented ? 'Accented' : 'Normal'}
      </button>
    </div>
  )
}

function TempoControl({ tempo, onTempoChange }: TempoControlProps) {
  return (
    <label htmlFor="custom-exercise-tempo" className="mt-4 block text-xs font-semibold text-smoke-300">
      <span className="flex justify-between gap-3"><span>Medium tempo</span><span className="tabular-nums text-flame-200">{tempo} BPM</span></span>
      <input id="custom-exercise-tempo" name="custom-exercise-tempo" type="range" min="40" max="240" value={tempo} onChange={(event) => onTempoChange(Number(event.target.value))} autoComplete="off" className={cn('mt-2 w-full accent-flame-400', focusRing)} data-testid="custom-exercise-tempo" />
    </label>
  )
}

function ExerciseComposer({ beatsPerBar, beatUnit, name, tempo, steps, onNameChange, onTempoChange, onPlayToggle, onAccentToggle, onSave, onClose }: ExerciseComposerProps) {
  return (
    <form className="mt-4 rounded-xl border border-flame-400/30 bg-charcoal-900/70 p-4" onSubmit={onSave} data-testid="strumming-composer">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-smoke-100">Build {beatsPerBar}/{beatUnit} pattern</h3>
        <button type="button" onClick={onClose} className={cn('min-h-11 px-2 text-xs text-smoke-400 hover:text-smoke-100', focusRing)} data-testid="close-strumming-composer">Cancel</button>
      </div>
      <label htmlFor="custom-exercise-name" className="mt-3 block text-xs font-semibold text-smoke-300">Exercise name</label>
      <input id="custom-exercise-name" name="custom-exercise-name" value={name} onChange={(event) => onNameChange(event.target.value)} required pattern=".*\S.*" title="Enter at least one non-space character." maxLength={40} autoComplete="off" className={cn('mt-1 min-h-11 w-full rounded-lg border border-charcoal-600 bg-charcoal-950 px-3 text-sm text-smoke-100', focusRing)} data-testid="custom-exercise-name" />
      <TempoControl tempo={tempo} onTempoChange={onTempoChange} />
      <p className="mt-4 text-xs text-smoke-400">Choose whether each fixed-direction stroke is played, then accent any played stroke.</p>
      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
        {steps.map((action, index) => <DraftStepControl key={index} index={index} action={action} onPlayToggle={onPlayToggle} onAccentToggle={onAccentToggle} />)}
      </div>
      <button type="submit" className={cn('mt-4 min-h-11 touch-manipulation rounded-lg border border-flame-400/50 bg-flame-400/15 px-4 text-sm font-semibold text-flame-100 transition-colors hover:border-flame-300 motion-reduce:transition-none', focusRing)} data-testid="save-strumming-exercise">Save exercise</button>
    </form>
  )
}

function ScreenAwakeStatus({ status }: ScreenAwakeStatusProps) {
  return (
    <p className="mt-3 flex items-center gap-2 text-xs text-smoke-400" aria-live="polite" data-testid="screen-wake-lock-status">
      <span className={cn('size-2 rounded-full', status === 'active' ? 'bg-emerald-400' : 'bg-smoke-600')} aria-hidden="true" />
      {wakeLockMessages[status]}
    </p>
  )
}

function exercisesForMeter(exercises: StrummingExercise[], beatsPerBar: number, beatUnit: number): StrummingExercise[] {
  return exercises.filter((exercise) => exercise.beatsPerBar === beatsPerBar && exercise.beatUnit === beatUnit)
}

function PracticeControls({ onInvent, onCompose }: PracticeControlsProps) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 className="text-lg font-semibold text-smoke-100">Strumming practice</h2>
        <p className="mt-1 text-sm text-smoke-400">Lock alternating strokes to the metronome.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={onInvent} className={cn('inline-flex min-h-11 items-center gap-2 rounded-lg border border-charcoal-600 bg-charcoal-800 px-3 text-sm font-semibold text-smoke-200 hover:border-flame-400/40', focusRing)} data-testid="invent-strumming-pattern">
          <Dice5 size={16} aria-hidden="true" /> Invent pattern
        </button>
        <button type="button" onClick={onCompose} className={cn('inline-flex min-h-11 items-center gap-2 rounded-lg border border-flame-400/40 bg-flame-400/10 px-3 text-sm font-semibold text-flame-200 hover:border-flame-300/60', focusRing)} data-testid="compose-strumming-pattern">
          <PencilLine size={16} aria-hidden="true" /> Compose
        </button>
      </div>
    </div>
  )
}

function ExerciseSelect({ exercises, selectedExercise, onSelect }: ExerciseSelectProps) {
  return (
    <>
      <label htmlFor="strumming-exercise-select" className="mt-4 block text-xs font-semibold text-smoke-300">Exercise</label>
      <select id="strumming-exercise-select" value={selectedExercise?.id ?? ''} onChange={(event) => onSelect(event.target.value)} disabled={!selectedExercise} className={cn('mt-1 min-h-11 w-full rounded-lg border border-charcoal-600 bg-charcoal-900 px-3 text-sm text-smoke-100 disabled:opacity-50', focusRing)} data-testid="strumming-exercise-select">
        {!selectedExercise && <option value="">No exercises for this meter</option>}
        {exercises.map((exercise) => <option key={exercise.id} value={exercise.id}>{exercise.name}</option>)}
      </select>
    </>
  )
}

function PracticeLevelSelect({ level, onChange }: PracticeLevelSelectProps) {
  return (
    <label htmlFor="strumming-practice-level" className="mt-3 block text-xs font-semibold text-smoke-300">
      Level
      <select
        id="strumming-practice-level"
        name="strumming-practice-level"
        value={level}
        onChange={(event) => onChange(event.target.value as PracticeLevel)}
        className={cn('mt-1 min-h-11 w-full rounded-lg border border-charcoal-600 bg-charcoal-900 px-3 text-sm text-smoke-100', focusRing)}
        data-testid="strumming-practice-level"
      >
        {PRACTICE_LEVEL_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </label>
  )
}

function SelectedExercise({ exercise, level, enabled, subdivision, onDelete }: SelectedExerciseProps) {
  const tempo = practiceTempo(exercise, level)
  return (
    <div className="mt-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h3 className="break-words font-semibold text-smoke-100" data-testid="strumming-exercise-name">{exercise.name}</h3>
          <p className="mt-1 text-sm text-smoke-400">{exercise.description}</p>
          <p className="mt-1 text-xs font-semibold capitalize tabular-nums text-flame-200" data-testid="strumming-exercise-tempo">{level} · {tempo} BPM</p>
        </div>
        {exercise.custom && (
          <button
            type="button"
            onClick={() => {
              if (window.confirm(`Delete ${exercise.name}? This cannot be undone.`)) onDelete(exercise.id)
            }}
            className={cn('inline-flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm font-semibold text-rose-300 hover:bg-rose-400/10', focusRing)}
            data-testid="delete-strumming-exercise"
          >
            <Trash2 size={16} aria-hidden="true" /> Delete
          </button>
        )}
      </div>
      <p className="mt-4 text-sm text-smoke-300">Keep your hand moving down/up through skips; mute the stroke, not the motion. <span className="font-semibold text-sky-200">Blue strokes are accents.</span></p>
      <div className="mt-3"><PatternGrid steps={exercise.steps} enabled={enabled} subdivision={subdivision} /></div>
    </div>
  )
}

function createCustomExercise(name: string, steps: StrumAction[], bpm: number, beatsPerBar: number, beatUnit: number): StrummingExercise {
  return {
    id: `custom-${crypto.randomUUID()}`,
    name,
    description: `Your ${beatsPerBar}/${beatUnit} pattern at ${bpm} BPM.`,
    beatsPerBar,
    beatUnit,
    steps: [...steps],
    bpm,
    custom: true,
  }
}

function togglePlayed(action: StrumAction): StrumAction {
  return action === 'rest' ? 'play' : 'rest'
}

function toggleAccent(action: StrumAction): StrumAction {
  return action === 'accent' ? 'play' : 'accent'
}

function usePracticeState(beatsPerBar: number, beatUnit: number, bpm: number, onBpmChange: (value: number) => void) {
  const customExercises = useStrummingExercisesStore((state) => state.customExercises)
  const addExercise = useStrummingExercisesStore((state) => state.addExercise)
  const removeExercise = useStrummingExercisesStore((state) => state.removeExercise)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [level, setLevel] = useState<PracticeLevel>('medium')
  const [composerOpen, setComposerOpen] = useState(false)
  const [draftName, setDraftName] = useState('')
  const [draftTempo, setDraftTempo] = useState(bpm)
  const [draftSteps, setDraftSteps] = useState<StrumAction[]>([])
  const availableExercises = exercisesForMeter([...COMMON_STRUMMING_EXERCISES, ...customExercises], beatsPerBar, beatUnit)
  const selectedExercise = availableExercises.find((exercise) => exercise.id === selectedId) ?? availableExercises[0]
  const selectedTempo = selectedExercise ? practiceTempo(selectedExercise, level) : null
  useEffect(() => {
    if (selectedTempo !== null) onBpmChange(selectedTempo)
  }, [selectedExercise?.id, selectedTempo, onBpmChange])
  const startComposer = (invented: boolean) => {
    setDraftName(invented ? 'Fresh pattern' : '')
    setDraftTempo(selectedExercise ? selectedExercise.bpm ?? 120 : bpm)
    setDraftSteps(invented ? createRandomSteps(beatsPerBar) : createPracticeSteps(beatsPerBar))
    setComposerOpen(true)
  }
  const updateStep = (index: number, update: (action: StrumAction) => StrumAction) => {
    setDraftSteps((steps) => steps.map((action, stepIndex) => stepIndex === index ? update(action) : action))
  }
  const selectExercise = (id: string) => setSelectedId(id)
  const saveExercise = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const exercise = createCustomExercise(draftName.trim(), draftSteps, draftTempo, beatsPerBar, beatUnit)
    addExercise(exercise)
    setSelectedId(exercise.id)
    setComposerOpen(false)
  }
  return {
    availableExercises, selectedExercise, removeExercise, level, composerOpen, draftName, draftTempo, draftSteps,
    setLevel, setDraftName, setDraftTempo, selectExercise, saveExercise,
    inventPattern: () => startComposer(true), openComposer: () => startComposer(false),
    togglePlay: (index: number) => updateStep(index, togglePlayed),
    toggleAccent: (index: number) => updateStep(index, toggleAccent),
    closeComposer: () => setComposerOpen(false),
  }
}

export function StrummingPractice({ bpm, beatsPerBar, beatUnit, enabled, subdivision, onBpmChange }: StrummingPracticeProps) {
  const practice = usePracticeState(beatsPerBar, beatUnit, bpm, onBpmChange)
  const wakeLockStatus = useScreenWakeLock(enabled)

  return (
    <section className="mt-6 border-t border-white/10 pt-6" data-testid="strumming-practice">
      <PracticeControls onInvent={practice.inventPattern} onCompose={practice.openComposer} />
      <ScreenAwakeStatus status={wakeLockStatus} />
      <ExerciseSelect exercises={practice.availableExercises} selectedExercise={practice.selectedExercise} onSelect={practice.selectExercise} />
      <PracticeLevelSelect level={practice.level} onChange={practice.setLevel} />
      {practice.selectedExercise
        ? <SelectedExercise exercise={practice.selectedExercise} level={practice.level} enabled={enabled} subdivision={subdivision} onDelete={practice.removeExercise} />
        : <p className="mt-4 text-sm text-smoke-400">No saved or common exercises match this meter. Invent one or compose your own.</p>}
      {practice.composerOpen && <ExerciseComposer beatsPerBar={beatsPerBar} beatUnit={beatUnit} name={practice.draftName} tempo={practice.draftTempo} steps={practice.draftSteps} onNameChange={practice.setDraftName} onTempoChange={practice.setDraftTempo} onPlayToggle={practice.togglePlay} onAccentToggle={practice.toggleAccent} onSave={practice.saveExercise} onClose={practice.closeComposer} />}
    </section>
  )
}

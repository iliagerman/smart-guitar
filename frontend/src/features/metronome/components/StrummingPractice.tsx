import { useState, type FormEvent } from 'react'
import { Dice5, PencilLine, Trash2 } from 'lucide-react'
import { cn } from '@/lib/cn'
import {
  COMMON_STRUMMING_EXERCISES,
  createPracticeSteps,
  createRandomExercise,
  type StrumAction,
  type StrummingExercise,
} from '../lib/strumming-exercises'
import { useStrummingExercisesStore } from '@/stores/strumming-exercises.store'

interface StrummingPracticeProps {
  beatsPerBar: number
  beatUnit: number
  enabled: boolean
  subdivision: number
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
  steps: StrumAction[]
  onNameChange: (name: string) => void
  onStepChange: (index: number) => void
  onSave: (event: FormEvent<HTMLFormElement>) => void
  onClose: () => void
}

interface DraftStepButtonProps {
  index: number
  action: StrumAction
  onStepChange: (index: number) => void
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

interface SelectedExerciseProps {
  exercise: StrummingExercise
  enabled: boolean
  subdivision: number
  onDelete: (id: string) => void
}

const focusRing = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-flame-400/40'

function slotLabel(index: number): string {
  return index % 2 === 0 ? String(index / 2 + 1) : '&'
}

function actionLabel(action: StrumAction): string {
  if (action === 'accent') return 'Accent'
  if (action === 'play') return 'Strum'
  return 'Skip'
}

function nextAction(action: StrumAction): StrumAction {
  if (action === 'rest') return 'play'
  if (action === 'play') return 'accent'
  return 'rest'
}

function PracticeStep({ index, action, active }: PracticeStepProps) {
  const downstroke = index % 2 === 0
  const direction = downstroke ? 'down' : 'up'

  return (
    <div
      className={cn(
        'min-h-28 rounded-xl border p-3 text-center transition-colors motion-reduce:transition-none',
        active ? 'border-flame-300 bg-flame-400/15 shadow-[0_0_20px_rgba(251,146,60,0.2)]' : 'border-white/10 bg-charcoal-900/50',
        action === 'rest' && !active && 'opacity-45',
        action === 'accent' && 'border-flame-400/60 bg-flame-400/10',
      )}
      data-metronome-tick={downstroke ? 'true' : undefined}
      data-testid={`strum-step-${index}`}
    >
      <div className="text-xs font-semibold text-smoke-400">{slotLabel(index)}</div>
      <div className={cn('mt-1 text-3xl font-bold leading-none', downstroke ? 'text-emerald-400' : 'text-amber-300')}>
        {downstroke ? '↓' : '↑'}
      </div>
      <div className="mt-2 text-xs font-semibold uppercase tracking-wide text-smoke-200">{actionLabel(action)}</div>
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

function DraftStepButton({ index, action, onStepChange }: DraftStepButtonProps) {
  const downstroke = index % 2 === 0
  return (
    <button
      type="button"
      onClick={() => onStepChange(index)}
      className={cn(
        'min-h-11 rounded-lg border px-2 text-xs font-semibold transition-colors',
        focusRing,
        action === 'accent' ? 'border-flame-400/60 bg-flame-400/15 text-flame-200' : 'border-charcoal-600 bg-charcoal-800 text-smoke-200 hover:border-flame-400/40',
        action === 'rest' && 'opacity-60',
      )}
      aria-label={`Set ${slotLabel(index)} ${downstroke ? 'down' : 'up'} stroke to ${nextAction(action)}`}
      data-testid={`custom-strum-step-${index}`}
    >
      {downstroke ? '↓' : '↑'} {slotLabel(index)} · {actionLabel(action)}
    </button>
  )
}

function ExerciseComposer({ beatsPerBar, beatUnit, name, steps, onNameChange, onStepChange, onSave, onClose }: ExerciseComposerProps) {
  return (
    <form className="mt-4 rounded-xl border border-flame-400/30 bg-charcoal-900/70 p-4" onSubmit={onSave} data-testid="strumming-composer">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-smoke-100">Compose {beatsPerBar}/{beatUnit}</h3>
        <button
          type="button"
          onClick={onClose}
          className={cn('min-h-11 px-2 text-xs text-smoke-400 hover:text-smoke-100', focusRing)}
          data-testid="close-strumming-composer"
        >
          Cancel
        </button>
      </div>
      <label htmlFor="custom-exercise-name" className="mt-3 block text-xs font-semibold text-smoke-300">Exercise name</label>
      <input
        id="custom-exercise-name"
        name="custom-exercise-name"
        value={name}
        onChange={(event) => onNameChange(event.target.value)}
        required
        maxLength={40}
        autoComplete="off"
        className={cn('mt-1 min-h-11 w-full rounded-lg border border-charcoal-600 bg-charcoal-950 px-3 text-sm text-smoke-100', focusRing)}
        data-testid="custom-exercise-name"
      />
      <p className="mt-3 text-xs text-smoke-400">Cycle each fixed-direction slot from Skip to Strum to Accent.</p>
      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {steps.map((action, index) => <DraftStepButton key={index} index={index} action={action} onStepChange={onStepChange} />)}
      </div>
      <button type="submit" disabled={!name.trim()} className={cn('mt-4 min-h-11 rounded-lg border border-flame-400/50 bg-flame-400/15 px-4 text-sm font-semibold text-flame-100 transition-colors hover:border-flame-300 disabled:cursor-not-allowed disabled:opacity-40', focusRing)} data-testid="save-strumming-exercise">
        Save exercise
      </button>
    </form>
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

function SelectedExercise({ exercise, enabled, subdivision, onDelete }: SelectedExerciseProps) {
  return (
    <div className="mt-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-semibold text-smoke-100" data-testid="strumming-exercise-name">{exercise.name}</h3>
          <p className="mt-1 text-sm text-smoke-400">{exercise.description}</p>
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
      <p className="mt-4 text-sm text-smoke-300">Keep your hand moving down/up through skips; mute the stroke, not the motion.</p>
      <div className="mt-3"><PatternGrid steps={exercise.steps} enabled={enabled} subdivision={subdivision} /></div>
    </div>
  )
}

function createCustomExercise(name: string, steps: StrumAction[], beatsPerBar: number, beatUnit: number): StrummingExercise {
  return {
    id: `custom-${crypto.randomUUID()}`,
    name,
    description: `Your ${beatsPerBar}/${beatUnit} pattern.`,
    beatsPerBar,
    beatUnit,
    steps: [...steps],
    custom: true,
  }
}

function usePracticeState(beatsPerBar: number, beatUnit: number) {
  const customExercises = useStrummingExercisesStore((state) => state.customExercises)
  const addExercise = useStrummingExercisesStore((state) => state.addExercise)
  const removeExercise = useStrummingExercisesStore((state) => state.removeExercise)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [generatedExercise, setGeneratedExercise] = useState<StrummingExercise | null>(null)
  const [composerOpen, setComposerOpen] = useState(false)
  const [draftName, setDraftName] = useState('')
  const [draftSteps, setDraftSteps] = useState<StrumAction[]>([])
  const compatibleExercises = exercisesForMeter([...COMMON_STRUMMING_EXERCISES, ...customExercises], beatsPerBar, beatUnit)
  const availableExercises = generatedExercise ? [...compatibleExercises, generatedExercise] : compatibleExercises
  const selectedExercise = availableExercises.find((exercise) => exercise.id === selectedId) ?? availableExercises[0]
  const inventPattern = () => {
    const exercise = createRandomExercise(beatsPerBar, beatUnit)
    setGeneratedExercise(exercise)
    setSelectedId(exercise.id)
  }
  const openComposer = () => {
    setDraftName('')
    setDraftSteps(createPracticeSteps(beatsPerBar))
    setComposerOpen(true)
  }
  const cycleDraftStep = (index: number) => {
    setDraftSteps((steps) => steps.map((action, stepIndex) => stepIndex === index ? nextAction(action) : action))
  }
  const saveExercise = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const exercise = createCustomExercise(draftName.trim(), draftSteps, beatsPerBar, beatUnit)
    addExercise(exercise)
    setSelectedId(exercise.id)
    setComposerOpen(false)
  }
  return {
    availableExercises,
    selectedExercise,
    removeExercise,
    composerOpen,
    draftName,
    draftSteps,
    setSelectedId,
    setDraftName,
    inventPattern,
    openComposer,
    cycleDraftStep,
    saveExercise,
    closeComposer: () => setComposerOpen(false),
  }
}

export function StrummingPractice({ beatsPerBar, beatUnit, enabled, subdivision }: StrummingPracticeProps) {
  const practice = usePracticeState(beatsPerBar, beatUnit)

  return (
    <section className="mt-6 border-t border-white/10 pt-6" data-testid="strumming-practice">
      <PracticeControls onInvent={practice.inventPattern} onCompose={practice.openComposer} />
      <ExerciseSelect exercises={practice.availableExercises} selectedExercise={practice.selectedExercise} onSelect={practice.setSelectedId} />
      {practice.selectedExercise
        ? <SelectedExercise exercise={practice.selectedExercise} enabled={enabled} subdivision={subdivision} onDelete={practice.removeExercise} />
        : <p className="mt-4 text-sm text-smoke-400">No saved or common exercises match this meter. Invent one or compose your own.</p>}
      {practice.composerOpen && <ExerciseComposer beatsPerBar={beatsPerBar} beatUnit={beatUnit} name={practice.draftName} steps={practice.draftSteps} onNameChange={practice.setDraftName} onStepChange={practice.cycleDraftStep} onSave={practice.saveExercise} onClose={practice.closeComposer} />}
    </section>
  )
}

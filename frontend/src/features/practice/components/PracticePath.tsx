import { Check, Lock, Repeat, X } from 'lucide-react'
import { cn } from '@/lib/cn'
import type { PracticeProgress, PracticeStep } from '@/types/practice'
import { PRACTICE_STEPS, stepInfo } from '../lib/practice-steps'
import { LearnShapes } from './LearnShapes'

interface PracticePathProps {
  progress: PracticeProgress
  activeStep: PracticeStep | null
  isPro: boolean
  shapes: string[]
  currentChord: string | null
  stageFraction: number
  hasVerseLoop: boolean
  onGoToStep: (step: PracticeStep) => void
  onFinishStep: (step: PracticeStep) => void
  onLeave: () => void
  onToggleShape: (chord: string) => void
}

interface StageGoalProps {
  fraction: number
  step: PracticeStep
}

function StageGoal({ fraction, step }: StageGoalProps) {
  const pct = Math.round(Math.min(1, fraction) * 100)
  return (
    <div className="flex items-center gap-3" data-testid="stage-goal">
      <div
        className="grid size-10 shrink-0 place-items-center rounded-full"
        style={{ background: `conic-gradient(#f97316 0 ${pct}%, #2b2630 ${pct}% 100%)` }}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        aria-label="Song played through"
      >
        <span className="grid size-[1.9rem] place-items-center rounded-full bg-stage-950 text-[10px] font-extrabold text-smoke-100">{pct}%</span>
      </div>
      <div className="min-w-0 text-xs">
        <p className="font-bold text-smoke-100">
          {step === 3 ? 'Play the song through at 75%' : 'Play it through at full speed'}
        </p>
        <p className="text-smoke-400">
          {step === 3 ? 'Then full speed and recording unlock (step 4)' : 'Hit Record in the tools to hear yourself with the band'}
        </p>
      </div>
    </div>
  )
}

/**
 * The song as a short path — Hear it → Learn it → Play it with the band → Full
 * speed — shown as a stepper with the active step's instruction and controls.
 */
export function PracticePath({
  progress,
  activeStep,
  isPro,
  shapes,
  currentChord,
  stageFraction,
  hasVerseLoop,
  onGoToStep,
  onFinishStep,
  onLeave,
  onToggleShape,
}: PracticePathProps) {
  const active = activeStep ? stepInfo(activeStep) : null
  const resume = stepInfo(progress.current_step)

  const stepButtons = (compact: boolean) =>
    PRACTICE_STEPS.map(({ step, title, short, pro }) => {
      const done = progress.completed_steps.includes(step)
      const isActive = activeStep === step
      const locked = pro && !isPro
      return (
        <li key={step} className={compact ? undefined : 'min-w-0'}>
          <button
            type="button"
            onClick={() => onGoToStep(step)}
            aria-current={isActive ? 'step' : undefined}
            aria-label={`Step ${step}: ${title}${done ? ' (done)' : ''}${locked ? ' (Pro)' : ''}`}
            className={cn(
              'flex items-center rounded-xl transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-flame-400/60',
              compact ? 'p-0.5' : 'w-full flex-col gap-0.5 px-1 py-1.5 text-center',
              !compact && (isActive ? 'bg-fire-500/20 ring-1 ring-fire-500' : 'hover:bg-white/5'),
            )}
            data-testid={`practice-step-${step}`}
            data-done={done}
          >
            <span
              className={cn(
                'grid size-6 place-items-center rounded-full text-[11px] font-extrabold',
                done ? 'bg-green-600 text-white' : isActive || (compact && step === progress.current_step) ? 'bg-fire-500 text-white' : 'bg-white/10 text-smoke-300',
              )}
            >
              {done ? <Check size={13} strokeWidth={3} aria-hidden="true" /> : locked ? <Lock size={11} aria-hidden="true" /> : step}
            </span>
            {!compact && (
              <span className={cn('truncate text-[10.5px] font-semibold leading-tight', isActive ? 'text-fire-300' : 'text-smoke-300')}>
                {short}
              </span>
            )}
          </button>
        </li>
      )
    })

  if (!active) {
    const finished = progress.completed_steps.length === 4
    return (
      <section
        className="flex items-center gap-3 rounded-[1.4rem] border border-white/10 bg-white/[0.035] px-3 py-2"
        aria-label="Practice path"
        data-testid="practice-path"
      >
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-extrabold tracking-[0.14em] text-smoke-400">
            {finished ? 'SONG COMPLETE · REPLAY ANY STEP' : `YOUR PATH · NEXT: ${resume.title.toUpperCase()}`}
          </p>
          <ol className="mt-1 flex items-center gap-1.5">{stepButtons(true)}</ol>
        </div>
        {!finished && (
          <button
            type="button"
            onClick={() => onGoToStep(resume.step)}
            className="shrink-0 rounded-full bg-fire-500 px-4 py-2 text-xs font-extrabold text-white transition-colors hover:bg-fire-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-flame-400/70"
            data-testid="practice-start-button"
          >
            {progress.completed_steps.length === 0 && progress.current_step === 1 ? 'Start: Hear it' : `Continue: ${resume.short}`}
          </button>
        )}
      </section>
    )
  }

  return (
    <section className="rounded-[1.4rem] border border-white/10 bg-white/[0.035] p-2" aria-label="Practice path" data-testid="practice-path">
      <ol className="grid grid-cols-4 gap-1">{stepButtons(false)}</ol>

      <div className="mt-2 space-y-2 px-1" data-testid="practice-step-panel">
        <div className="flex items-start gap-2">
          <p className="flex-1 text-xs leading-snug text-smoke-300">
            <b className="text-smoke-100">{active.title}.</b> {active.instruction}
          </p>
          <button
            type="button"
            onClick={onLeave}
            className="grid size-7 shrink-0 place-items-center rounded-full bg-white/10 text-smoke-300 hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-flame-400/60"
            aria-label="Leave the practice path and just jam"
            data-testid="practice-leave-button"
          >
            <X size={14} aria-hidden="true" />
          </button>
        </div>

        {active.step === 2 && (
          <>
            {hasVerseLoop && (
              <p className="flex items-center gap-1.5 text-[10.5px] font-bold tracking-wide text-flame-300">
                <Repeat size={12} aria-hidden="true" /> LOOPING VERSE 1 · 75% SPEED · {progress.learned_chords.length} OF {shapes.length} SHAPES DOWN
              </p>
            )}
            <LearnShapes shapes={shapes} learned={progress.learned_chords} currentChord={currentChord} onToggle={onToggleShape} />
          </>
        )}
        {(active.step === 3 || active.step === 4) && <StageGoal fraction={stageFraction} step={active.step} />}

        <button
          type="button"
          onClick={() => onFinishStep(active.step)}
          className="w-full rounded-full bg-fire-500 py-2.5 text-sm font-extrabold text-white shadow-[0_10px_24px_rgba(249,115,22,0.35)] transition-colors hover:bg-fire-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-flame-400/70"
          data-testid="practice-finish-button"
        >
          {active.step < 4 && stepInfo((active.step + 1) as PracticeStep).pro && !isPro
            ? `${active.doneLabel.split(' → ')[0]} → unlock the stage`
            : active.doneLabel}
        </button>
      </div>
    </section>
  )
}

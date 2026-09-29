import { useRef } from 'react'
import { Lock } from 'lucide-react'
import { cn } from '@/lib/cn'
import { StemIcon } from '@/features/player/components/StemIcons'
import type { SongStems, StemType } from '@/types/song'

const LONG_PRESS_MS = 450

interface BandStageProps {
  stemTypes: StemType[]
  stems: SongStems
  /** Per-stem volume (0..1) while the band stems are playing. */
  stemVolumes?: Record<string, number>
  /** Free plan: only the guitar stem is available, the rest of the band is Pro. */
  locked: boolean
  /** Free plan: whether the isolated guitar is playing instead of the full mix. */
  guitarSolo: boolean
  disabled?: boolean
  onSetVolumes: (volumes: Record<string, number>) => void
  onToggleGuitarSolo: () => void
  onLockedMember: () => void
}

interface MemberProps {
  stem: StemType
  live: boolean
  isYou: boolean
  locked: boolean
  available: boolean
  disabled: boolean
  onTap: () => void
  onSolo: () => void
}

function Member({ stem, live, isYou, locked, available, disabled, onTap, onSolo }: MemberProps) {
  const timer = useRef<number | null>(null)
  const longPressed = useRef(false)

  const clearTimer = () => {
    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = null
  }

  const state = isYou ? 'your seat — tap to bring the guitarist back' : live ? 'playing' : 'muted'

  return (
    <button
      type="button"
      disabled={disabled || (!available && !locked)}
      onPointerDown={() => {
        longPressed.current = false
        clearTimer()
        timer.current = window.setTimeout(() => {
          longPressed.current = true
          onSolo()
        }, LONG_PRESS_MS)
      }}
      onPointerUp={clearTimer}
      onPointerLeave={clearTimer}
      onContextMenu={(e) => e.preventDefault()}
      onClick={() => {
        if (longPressed.current) return
        onTap()
      }}
      onKeyDown={(e) => {
        if (e.key === 's' || e.key === 'S') {
          e.preventDefault()
          onSolo()
        }
      }}
      className="group flex w-12 shrink-0 select-none flex-col items-center gap-0.5 text-[10px] font-medium text-smoke-300 sm:w-14 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40"
      aria-label={`${stem.label}: ${locked ? 'Pro — tap to unlock the band' : state}. Long-press or press S to solo.`}
      data-testid={`band-member-${stem.name}`}
      data-state={isYou ? 'you' : live ? 'live' : 'muted'}
    >
      <span
        className={cn(
          'relative grid size-9 place-items-center rounded-full border-2 sm:size-10 transition-[border-color,box-shadow,opacity,transform] group-hover:scale-105 group-focus-visible:ring-2 group-focus-visible:ring-flame-400/70',
          isYou
            ? 'border-dashed border-flame-400 bg-flame-400/10 text-xs font-black text-flame-300'
            : live
              ? 'border-fire-500 bg-stage-800 text-smoke-100 shadow-[0_0_0_3px_rgba(249,115,22,0.12)] sm:shadow-[0_0_0_4px_rgba(249,115,22,0.16),0_0_16px_rgba(249,115,22,0.4)]'
              : 'border-[#3b3342] bg-stage-800 text-smoke-500 opacity-60',
        )}
      >
        {isYou ? 'YOU' : <StemIcon stem={stem.name} size={18} />}
        {locked && (
          <span className="absolute -right-1 -top-1 grid size-4 place-items-center rounded-full bg-ink-900 text-flame-300 ring-1 ring-flame-400/40">
            <Lock size={9} aria-hidden="true" />
          </span>
        )}
      </span>
      <span className={cn('max-w-full truncate', isYou && 'font-bold text-flame-300')}>
        {isYou ? 'You' : stem.label}
      </span>
    </button>
  )
}

/**
 * The band on stage: one member per stem. Tap to kick a member out (or bring
 * them back), long-press to solo. Muting the guitarist leaves the dashed
 * "YOU" seat — the core play-along idea, with no mixer to find.
 */
export function BandStage({
  stemTypes,
  stems,
  stemVolumes,
  locked,
  guitarSolo,
  disabled = false,
  onSetVolumes,
  onToggleGuitarSolo,
  onLockedMember,
}: BandStageProps) {
  const available = stemTypes.filter(({ name }) => !!stems[name])
  if (stemTypes.length === 0 || (!locked && available.length === 0)) return null

  const volumeOf = (name: string) => stemVolumes?.[name] ?? 1
  const soloVolumes = (name: string) =>
    Object.fromEntries(available.map((s) => [s.name, s.name === name ? 1 : 0]))

  const hint = locked
    ? 'Tap the guitarist to hear his part alone · the rest of the band is Pro'
    : 'Tap a member to kick them out · long-press to solo'

  return (
    <div
      className="flex flex-col justify-center rounded-[1.4rem] border border-fire-500/20 bg-[linear-gradient(180deg,rgba(249,115,22,0.12),rgba(255,255,255,0.02))] px-2 pb-1.5 pt-2 max-sm:py-1.5"
      data-testid="band-stage"
    >
      <div className="flex justify-around gap-1 overflow-x-auto">
        {stemTypes.map((stem) => {
          const isGuitar = stem.name === 'guitar'
          if (locked) {
            const live = isGuitar || !guitarSolo
            return (
              <Member
                key={stem.name}
                stem={stem}
                live={live}
                isYou={false}
                locked={!isGuitar}
                available={isGuitar && !!stems.guitar}
                disabled={disabled}
                onTap={isGuitar ? onToggleGuitarSolo : onLockedMember}
                onSolo={isGuitar ? onToggleGuitarSolo : onLockedMember}
              />
            )
          }
          const live = volumeOf(stem.name) > 0
          return (
            <Member
              key={stem.name}
              stem={stem}
              live={live}
              isYou={isGuitar && !live}
              locked={false}
              available={!!stems[stem.name]}
              disabled={disabled}
              onTap={() => onSetVolumes({ [stem.name]: live ? 0 : 1 })}
              onSolo={() => onSetVolumes(soloVolumes(stem.name))}
            />
          )
        })}
      </div>
      <p className="mt-0.5 hidden text-center text-[10px] text-smoke-500 sm:block">{hint}</p>
    </div>
  )
}

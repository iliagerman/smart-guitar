import { useMemo, useState } from 'react'
import { Minus, Music2, Plus, RotateCcw, Volume2, VolumeX } from 'lucide-react'
import { cn } from '@/lib/cn'
import { useMetronome, type MetronomeMode } from '../hooks/use-metronome'

interface MetronomePanelProps {
  autoBpm?: number | null
  mode: MetronomeMode
  playbackTime?: number
  playbackPlaying?: boolean
  compact?: boolean
}

const MIN_BPM = 40
const MAX_BPM = 240

function clampBpm(value: number): number {
  if (!Number.isFinite(value)) return 120
  return Math.max(MIN_BPM, Math.min(MAX_BPM, Math.round(value)))
}

/**
 * Metronome controls with tempo override, visual beat indicator, and optional sound.
 */
export function MetronomePanel({
  autoBpm,
  mode,
  playbackTime,
  playbackPlaying,
  compact = false,
}: MetronomePanelProps) {
  const initialBpm = clampBpm(autoBpm ?? 120)
  const [manualBpm, setManualBpm] = useState(initialBpm)
  const [manualOverride, setManualOverride] = useState(!autoBpm)
  const [enabled, setEnabled] = useState(mode === 'playback')
  const [soundEnabled, setSoundEnabled] = useState(false)
  const bpm = manualOverride ? manualBpm : clampBpm(autoBpm ?? manualBpm)

  const { beat, triggerClick } = useMetronome({
    bpm,
    enabled,
    soundEnabled,
    mode,
    playbackTime,
    playbackPlaying,
  })

  const sourceLabel = useMemo(() => {
    if (!autoBpm) return 'Manual tempo'
    return manualOverride ? 'Manual override' : 'Synced to song'
  }, [autoBpm, manualOverride])

  const updateBpm = (value: number) => {
    setManualOverride(true)
    setManualBpm(clampBpm(value))
  }

  const useSongTempo = () => {
    if (!autoBpm) return
    setManualBpm(clampBpm(autoBpm))
    setManualOverride(false)
  }

  const toggleSound = () => {
    const next = !soundEnabled
    setSoundEnabled(next)
    if (next) triggerClick()
  }

  if (compact) {
    return (
      <section className="min-w-0 flex-1" data-testid="metronome-panel">
        <div className="flex items-center gap-2">
          <div className="grid min-w-0 flex-1 grid-cols-4 gap-1.5" aria-label="Beat indicator">
            {[0, 1, 2, 3].map((index) => {
              const active = beat === index && enabled
              return (
                <div
                  key={index}
                  className={cn(
                    'h-10 rounded-xl border transition-[border-color,background-color,box-shadow] duration-100',
                    active
                      ? 'border-flame-300 bg-flame-300 shadow-[0_0_22px_rgba(250,204,21,0.45)]'
                      : 'border-white/10 bg-white/[0.055]',
                  )}
                  data-testid={`metronome-beat-${index}`}
                />
              )
            })}
          </div>

          <button
            type="button"
            onClick={() => updateBpm(bpm - 1)}
            className="grid size-10 shrink-0 place-items-center rounded-xl border border-white/10 bg-white/[0.06] text-smoke-100 transition-colors hover:border-flame-400/30"
            aria-label="Decrease tempo"
            data-testid="metronome-tempo-decrease"
          >
            <Minus size={17} aria-hidden="true" />
          </button>

          <div className="w-14 shrink-0 text-center">
            <div className="text-xl font-black leading-none text-smoke-100" data-testid="metronome-bpm">{bpm}</div>
            <div className="text-[10px] uppercase tracking-wide text-smoke-500">BPM</div>
          </div>

          <button
            type="button"
            onClick={() => updateBpm(bpm + 1)}
            className="grid size-10 shrink-0 place-items-center rounded-xl border border-white/10 bg-white/[0.06] text-smoke-100 transition-colors hover:border-flame-400/30"
            aria-label="Increase tempo"
            data-testid="metronome-tempo-increase"
          >
            <Plus size={17} aria-hidden="true" />
          </button>

          {autoBpm && (
            <button
              type="button"
              onClick={useSongTempo}
              className="hidden shrink-0 rounded-xl border border-white/10 bg-white/[0.06] px-3 py-2 text-xs font-semibold text-smoke-300 transition-colors hover:border-flame-400/30 sm:block"
              data-testid="metronome-auto-sync-button"
            >
              Song
            </button>
          )}
        </div>
      </section>
    )
  }

  return (
    <section
      className={cn(
        'border border-white/10 bg-[#111215]/95 shadow-[0_0_60px_rgba(250,204,21,0.16),0_24px_90px_rgba(0,0,0,0.48)] backdrop-blur-2xl',
        compact
          ? 'w-full rounded-2xl p-4'
          : 'mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col justify-center rounded-[2rem] p-6 sm:p-8',
      )}
      data-testid="metronome-panel"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-flame-300">
            <Music2 size={18} aria-hidden="true" />
            Metronome
          </div>
          <p className="mt-1 text-sm text-smoke-400" data-testid="metronome-source">
            {sourceLabel}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setEnabled((value) => !value)}
          className={cn(
            'rounded-xl border px-4 py-2 text-sm font-semibold transition-colors',
            'focus:outline-none focus:ring-2 focus:ring-flame-400/40 focus:ring-offset-1 focus:ring-offset-charcoal-900',
            enabled
              ? 'border-flame-400/40 bg-flame-400/20 text-flame-200'
              : 'border-charcoal-600 bg-charcoal-800 text-smoke-200 hover:border-flame-400/30',
          )}
          data-testid="metronome-toggle-button"
        >
          {enabled ? 'Stop' : 'Start'}
        </button>
      </div>

      <div className={cn('grid grid-cols-4 gap-3', compact ? 'mt-5' : 'mt-10 sm:gap-5')} aria-label="Beat indicator">
        {[0, 1, 2, 3].map((index) => {
          const active = beat === index && enabled
          return (
            <div
              key={index}
              className={cn(
                'flex flex-col items-center justify-end rounded-3xl border transition-[border-color,background-color,box-shadow,transform] duration-100',
                compact ? 'h-16 p-2' : 'h-32 p-3 sm:h-44 sm:p-4',
                active
                  ? 'scale-[1.03] border-flame-300 bg-flame-300/18 shadow-[0_0_40px_rgba(250,204,21,0.30)]'
                  : 'border-white/10 bg-white/[0.045]',
              )}
              data-testid={`metronome-beat-${index}`}
            >
              <div
                className={cn(
                  'w-full rounded-full transition-[height,background-color,box-shadow] duration-100',
                  compact ? 'max-h-10' : 'max-h-28 sm:max-h-36',
                  active
                    ? 'h-full bg-flame-300 shadow-[0_0_24px_rgba(250,204,21,0.55)]'
                    : index === 0
                      ? 'h-2/3 bg-smoke-600/60'
                      : 'h-1/2 bg-smoke-700/60',
                )}
              />
              <span className={cn('mt-2 font-mono text-xs', active ? 'text-flame-200' : 'text-smoke-500')}>
                {index + 1}
              </span>
            </div>
          )
        })}
      </div>

      <div className={cn('text-center', compact ? 'mt-5' : 'mt-8')}>
        <div className={cn('font-display text-smoke-100', compact ? 'text-5xl' : 'text-7xl sm:text-8xl')} data-testid="metronome-bpm">
          {bpm}
        </div>
        <div className="text-xs uppercase tracking-wide text-smoke-500">BPM</div>
      </div>

      <div className={cn('flex items-center gap-3', compact ? 'mt-5' : 'mt-8')}>
        <button
          type="button"
          onClick={() => updateBpm(bpm - 1)}
          className="rounded-lg border border-charcoal-600 bg-charcoal-800 p-3 text-smoke-200 transition-colors hover:border-flame-400/30 focus:outline-none focus:ring-2 focus:ring-flame-400/40"
          aria-label="Decrease tempo"
          data-testid="metronome-tempo-decrease"
        >
          <Minus size={18} aria-hidden="true" />
        </button>
        <label className="sr-only" htmlFor="metronome-tempo-slider">Tempo</label>
        <input
          id="metronome-tempo-slider"
          name="tempo"
          type="range"
          min={MIN_BPM}
          max={MAX_BPM}
          value={bpm}
          onChange={(event) => updateBpm(Number(event.target.value))}
          className="w-full accent-flame-400"
          data-testid="metronome-tempo-slider"
        />
        <button
          type="button"
          onClick={() => updateBpm(bpm + 1)}
          className="rounded-lg border border-charcoal-600 bg-charcoal-800 p-3 text-smoke-200 transition-colors hover:border-flame-400/30 focus:outline-none focus:ring-2 focus:ring-flame-400/40"
          aria-label="Increase tempo"
          data-testid="metronome-tempo-increase"
        >
          <Plus size={18} aria-hidden="true" />
        </button>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
        <button
          type="button"
          onClick={toggleSound}
          className={cn(
            'inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-semibold transition-colors',
            'focus:outline-none focus:ring-2 focus:ring-flame-400/40',
            soundEnabled
              ? 'border-flame-400/40 bg-flame-400/15 text-flame-200'
              : 'border-charcoal-600 bg-charcoal-800 text-smoke-300 hover:border-flame-400/30',
          )}
          data-testid="metronome-sound-toggle"
        >
          {soundEnabled ? <Volume2 size={16} aria-hidden="true" /> : <VolumeX size={16} aria-hidden="true" />}
          Sound {soundEnabled ? 'on' : 'off'}
        </button>
        {autoBpm && (
          <button
            type="button"
            onClick={useSongTempo}
            className="inline-flex items-center gap-2 rounded-lg border border-charcoal-600 bg-charcoal-800 px-3 py-2 text-sm font-semibold text-smoke-300 transition-colors hover:border-flame-400/30 focus:outline-none focus:ring-2 focus:ring-flame-400/40"
            data-testid="metronome-auto-sync-button"
          >
            <RotateCcw size={16} aria-hidden="true" />
            Use song tempo ({clampBpm(autoBpm)})
          </button>
        )}
      </div>
    </section>
  )
}

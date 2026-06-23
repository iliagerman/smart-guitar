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
  const [enabled, setEnabled] = useState(false)
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

  return (
    <section
      className={cn(
        'rounded-2xl border border-charcoal-700 bg-charcoal-900/75 p-4 shadow-xl shadow-black/20',
        compact ? 'w-full' : 'mx-auto w-full max-w-xl',
      )}
      data-testid="metronome-panel"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-flame-400">
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

      <div className="mt-5 flex items-center justify-center gap-3" aria-label="Beat indicator">
        {[0, 1, 2, 3].map((index) => (
          <div
            key={index}
            className={cn(
              'h-4 w-4 rounded-full border transition-colors duration-100',
              beat === index && enabled
                ? 'border-flame-300 bg-flame-400 shadow-lg shadow-flame-400/30'
                : 'border-charcoal-600 bg-charcoal-800',
            )}
            data-testid={`metronome-beat-${index}`}
          />
        ))}
      </div>

      <div className="mt-5 text-center">
        <div className="text-5xl font-display text-smoke-100" data-testid="metronome-bpm">
          {bpm}
        </div>
        <div className="text-xs uppercase tracking-wide text-smoke-500">BPM</div>
      </div>

      <div className="mt-5 flex items-center gap-3">
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

import { useState } from 'react'
import { Minus, Music2, Plus, RotateCcw, Volume2, VolumeX } from 'lucide-react'
import { cn } from '@/lib/cn'
import { useMetronome, type MetronomeMode } from '../hooks/use-metronome'
import { resumeMetronomeAudio } from '../lib/metronome-audio'

interface MetronomePanelProps {
  autoBpm?: number | null
  mode: MetronomeMode
  playbackTime?: number
  playbackPlaying?: boolean
  compact?: boolean
}

interface BeatIndicatorProps {
  beat: number
  beatsPerBar: number
  enabled: boolean
  compact: boolean
}

interface MetronomeSettingsProps {
  beatsPerBar: number
  beatUnit: number
  soundEnabled: boolean
  volume: number
  onBeatsPerBarChange: (value: number) => void
  onBeatUnitChange: (value: number) => void
  onSoundToggle: () => void
  onVolumeChange: (value: number) => void
}

interface PanelViewProps extends MetronomeSettingsProps {
  autoBpm?: number | null
  bpm: number
  beat: number
  enabled: boolean
  sourceLabel: string
  onBpmChange: (value: number) => void
  onEnabledToggle: () => void
  onUseSongTempo: () => void
}

const MIN_BPM = 40
const MAX_BPM = 240
const BEATS_PER_BAR_OPTIONS = Array.from({ length: 16 }, (_, index) => index + 1)
const BEAT_UNIT_OPTIONS = [2, 4, 8, 16]
const focusRing = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-flame-400/40'

function clampBpm(value: number): number {
  if (!Number.isFinite(value)) return 120
  return Math.max(MIN_BPM, Math.min(MAX_BPM, Math.round(value)))
}

function BeatIndicator({ beat, beatsPerBar, enabled, compact }: BeatIndicatorProps) {
  const columns = beatsPerBar <= 4 ? 'grid-cols-4' : 'grid-cols-4 sm:grid-cols-8'
  return (
    <div className={cn('grid gap-1.5 sm:gap-2', columns)} aria-label="Beat indicator">
      {Array.from({ length: beatsPerBar }, (_, index) => {
        const active = beat === index && enabled
        return (
          <div
            key={index}
            className={cn(
              'flex flex-col items-center justify-end rounded-xl border transition-[border-color,background-color,box-shadow,transform] duration-100 motion-reduce:transition-none',
              compact ? 'h-8 p-1' : 'h-16 p-2 sm:h-20',
              active
                ? 'scale-[1.03] border-flame-300 bg-flame-300/18 shadow-[0_0_24px_rgba(250,204,21,0.3)]'
                : 'border-white/10 bg-white/[0.045]',
            )}
            data-accented={index === 0}
            data-testid={`metronome-beat-${index}`}
          >
            <div className={cn(
              'w-full rounded-full transition-[height,background-color,box-shadow] duration-100 motion-reduce:transition-none',
              active
                ? 'h-full bg-flame-300 shadow-[0_0_20px_rgba(250,204,21,0.5)]'
                : index === 0 ? 'h-2/3 bg-smoke-500/70' : 'h-1/2 bg-smoke-700/60',
            )} />
            {!compact && (
              <span className={cn('mt-1 font-mono text-[10px]', active ? 'text-flame-200' : 'text-smoke-500')}>{index + 1}</span>
            )}
          </div>
        )
      })}
    </div>
  )
}

function MetronomeSettings(props: MetronomeSettingsProps) {
  return (
    <div className="flex flex-wrap items-center justify-center gap-2">
      <label className="inline-flex items-center gap-1 rounded-lg border border-charcoal-600 bg-charcoal-800 px-2 py-2 text-xs font-semibold text-smoke-300 focus-within:border-flame-400/40">
        <span>Meter</span>
        <select
          name="metronome-beats-per-bar"
          value={props.beatsPerBar}
          onChange={(event) => props.onBeatsPerBarChange(Number(event.target.value))}
          className={cn('rounded bg-charcoal-900 px-1 py-0.5 text-smoke-100', focusRing)}
          aria-label="Beats per bar"
          data-testid="metronome-beats-per-bar"
        >
          {BEATS_PER_BAR_OPTIONS.map((value) => <option key={value} value={value}>{value}</option>)}
        </select>
        <span>/</span>
        <select
          name="metronome-beat-unit"
          value={props.beatUnit}
          onChange={(event) => props.onBeatUnitChange(Number(event.target.value))}
          className={cn('rounded bg-charcoal-900 px-1 py-0.5 text-smoke-100', focusRing)}
          aria-label="Beat unit"
          data-testid="metronome-beat-unit"
        >
          {BEAT_UNIT_OPTIONS.map((value) => <option key={value} value={value}>{value}</option>)}
        </select>
      </label>

      <button
        type="button"
        onClick={props.onSoundToggle}
        className={cn(
          'inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold transition-colors',
          focusRing,
          props.soundEnabled
            ? 'border-flame-400/40 bg-flame-400/15 text-flame-200 hover:border-flame-300/60'
            : 'border-charcoal-600 bg-charcoal-800 text-smoke-300 hover:border-flame-400/30',
        )}
        data-testid="metronome-sound-toggle"
      >
        {props.soundEnabled ? <Volume2 size={15} aria-hidden="true" /> : <VolumeX size={15} aria-hidden="true" />}
        Sound {props.soundEnabled ? 'on' : 'off'}
      </button>

      <label className="inline-flex min-w-40 flex-1 items-center gap-2 rounded-lg border border-charcoal-600 bg-charcoal-800 px-3 py-2 text-xs text-smoke-300 focus-within:border-flame-400/40">
        <span>Volume</span>
        <input
          name="metronome-volume"
          type="range"
          min="0"
          max="100"
          value={props.volume}
          onChange={(event) => props.onVolumeChange(Number(event.target.value))}
          className={cn('min-w-16 flex-1 accent-flame-400', focusRing)}
          aria-label="Metronome volume"
          data-testid="metronome-volume"
        />
        <span className="w-8 text-right tabular-nums" data-testid="metronome-volume-value">{props.volume}%</span>
      </label>
    </div>
  )
}

function CompactTempoControls({ bpm, autoBpm, onBpmChange, onUseSongTempo }: PanelViewProps) {
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => onBpmChange(bpm - 1)}
        className={cn('grid size-10 shrink-0 place-items-center rounded-xl border border-white/10 bg-white/[0.06] text-smoke-100 transition-colors hover:border-flame-400/30', focusRing)}
        aria-label="Decrease tempo"
        data-testid="metronome-tempo-decrease"
      >
        <Minus size={17} aria-hidden="true" />
      </button>
      <div className="w-14 shrink-0 text-center tabular-nums">
        <div className="text-xl font-black leading-none text-smoke-100" data-testid="metronome-bpm">{bpm}</div>
        <div className="text-[10px] uppercase tracking-wide text-smoke-500">BPM</div>
      </div>
      <button
        type="button"
        onClick={() => onBpmChange(bpm + 1)}
        className={cn('grid size-10 shrink-0 place-items-center rounded-xl border border-white/10 bg-white/[0.06] text-smoke-100 transition-colors hover:border-flame-400/30', focusRing)}
        aria-label="Increase tempo"
        data-testid="metronome-tempo-increase"
      >
        <Plus size={17} aria-hidden="true" />
      </button>
      {autoBpm && (
        <button
          type="button"
          onClick={onUseSongTempo}
          className={cn('hidden shrink-0 rounded-xl border border-white/10 bg-white/[0.06] px-3 py-2 text-xs font-semibold text-smoke-300 transition-colors hover:border-flame-400/30 sm:block', focusRing)}
          data-testid="metronome-auto-sync-button"
        >
          Song
        </button>
      )}
    </div>
  )
}

function CompactPanel(props: PanelViewProps) {
  return (
    <section className="min-w-0 flex-1" data-testid="metronome-panel">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <BeatIndicator beat={props.beat} beatsPerBar={props.beatsPerBar} enabled={props.enabled} compact />
        </div>
        <CompactTempoControls {...props} />
      </div>
      <div className="mt-2"><MetronomeSettings {...props} /></div>
    </section>
  )
}

function PanelHeader({ enabled, sourceLabel, onEnabledToggle }: PanelViewProps) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div>
        <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-flame-300">
          <Music2 size={18} aria-hidden="true" />
          Metronome
        </div>
        <p className="mt-1 text-sm text-smoke-400" data-testid="metronome-source">{sourceLabel}</p>
      </div>
      <button
        type="button"
        onClick={onEnabledToggle}
        className={cn(
          'rounded-xl border px-4 py-2 text-sm font-semibold transition-colors focus-visible:ring-offset-1 focus-visible:ring-offset-charcoal-900',
          focusRing,
          enabled
            ? 'border-flame-400/40 bg-flame-400/20 text-flame-200 hover:border-flame-300/60'
            : 'border-charcoal-600 bg-charcoal-800 text-smoke-200 hover:border-flame-400/30',
        )}
        data-testid="metronome-toggle-button"
      >
        {enabled ? 'Stop' : 'Start'}
      </button>
    </div>
  )
}

function TempoSlider({ bpm, onBpmChange }: PanelViewProps) {
  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={() => onBpmChange(bpm - 1)}
        className={cn('rounded-lg border border-charcoal-600 bg-charcoal-800 p-3 text-smoke-200 transition-colors hover:border-flame-400/30', focusRing)}
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
        onChange={(event) => onBpmChange(Number(event.target.value))}
        className={cn('w-full accent-flame-400', focusRing)}
        data-testid="metronome-tempo-slider"
      />
      <button
        type="button"
        onClick={() => onBpmChange(bpm + 1)}
        className={cn('rounded-lg border border-charcoal-600 bg-charcoal-800 p-3 text-smoke-200 transition-colors hover:border-flame-400/30', focusRing)}
        aria-label="Increase tempo"
        data-testid="metronome-tempo-increase"
      >
        <Plus size={18} aria-hidden="true" />
      </button>
    </div>
  )
}

function SongTempoButton({ autoBpm, onUseSongTempo }: PanelViewProps) {
  if (!autoBpm) return null
  return (
    <button
      type="button"
      onClick={onUseSongTempo}
      className={cn('mx-auto mt-3 inline-flex items-center gap-2 rounded-lg border border-charcoal-600 bg-charcoal-800 px-3 py-2 text-sm font-semibold text-smoke-300 transition-colors hover:border-flame-400/30', focusRing)}
      data-testid="metronome-auto-sync-button"
    >
      <RotateCcw size={16} aria-hidden="true" />
      Use song tempo ({clampBpm(autoBpm)})
    </button>
  )
}

function FullPanel(props: PanelViewProps) {
  return (
    <section
      className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col justify-start overflow-y-auto rounded-[2rem] sm:justify-center border border-white/10 bg-[#111215]/95 p-6 shadow-[0_0_60px_rgba(250,204,21,0.16),0_24px_90px_rgba(0,0,0,0.48)] backdrop-blur-2xl sm:p-8"
      data-testid="metronome-panel"
    >
      <PanelHeader {...props} />
      <div className="mt-6">
        <BeatIndicator beat={props.beat} beatsPerBar={props.beatsPerBar} enabled={props.enabled} compact={false} />
      </div>
      <div className="mt-5 text-center tabular-nums">
        <div className="font-display text-6xl text-smoke-100 sm:text-7xl" data-testid="metronome-bpm">{props.bpm}</div>
        <div className="text-xs uppercase tracking-wide text-smoke-500">
          BPM · <span data-testid="metronome-signature">{props.beatsPerBar}/{props.beatUnit}</span>
        </div>
      </div>
      <div className="mt-5"><TempoSlider {...props} /></div>
      <div className="mt-4"><MetronomeSettings {...props} /></div>
      <SongTempoButton {...props} />
    </section>
  )
}

function usePanelState({ autoBpm, mode, playbackTime, playbackPlaying }: MetronomePanelProps): PanelViewProps {
  const initialBpm = clampBpm(autoBpm ?? 120)
  const [manualBpm, setManualBpm] = useState(initialBpm)
  const [manualOverride, setManualOverride] = useState(!autoBpm)
  const [enabled, setEnabled] = useState(mode === 'playback')
  const [soundEnabled, setSoundEnabled] = useState(true)
  const [volume, setVolume] = useState(70)
  const [beatsPerBar, setBeatsPerBar] = useState(4)
  const [beatUnit, setBeatUnit] = useState(4)
  const bpm = manualOverride ? manualBpm : clampBpm(autoBpm ?? manualBpm)
  const metronome = useMetronome({ bpm, beatsPerBar, enabled, soundEnabled, volume: volume / 100, mode, playbackTime, playbackPlaying })

  const updateBpm = (value: number) => {
    setManualOverride(true)
    setManualBpm(clampBpm(value))
  }
  const useSongTempo = () => {
    if (!autoBpm) return
    setManualBpm(clampBpm(autoBpm))
    setManualOverride(false)
  }
  const toggleEnabled = () => {
    if (!enabled && soundEnabled) resumeMetronomeAudio()
    setEnabled((value) => !value)
  }
  const toggleSound = () => {
    const next = !soundEnabled
    setSoundEnabled(next)
    if (next) metronome.triggerClick()
  }

  return {
    autoBpm, bpm, beat: metronome.beat, enabled, beatsPerBar, beatUnit, soundEnabled, volume,
    sourceLabel: !autoBpm ? 'Manual tempo' : manualOverride ? 'Manual override' : 'Synced to song',
    onBpmChange: updateBpm, onEnabledToggle: toggleEnabled, onUseSongTempo: useSongTempo,
    onBeatsPerBarChange: setBeatsPerBar, onBeatUnitChange: setBeatUnit,
    onSoundToggle: toggleSound, onVolumeChange: setVolume,
  }
}

/** Metronome with tempo, meter, accented downbeat, and click volume controls. */
export function MetronomePanel(props: MetronomePanelProps) {
  const panelState = usePanelState(props)
  return props.compact ? <CompactPanel {...panelState} /> : <FullPanel {...panelState} />
}

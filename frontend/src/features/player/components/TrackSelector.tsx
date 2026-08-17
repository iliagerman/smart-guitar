import * as Popover from '@radix-ui/react-popover'
import { Volume2, VolumeX } from 'lucide-react'
import { useMemo } from 'react'

import { cn } from '@/lib/cn'
import { isAppleMobileSafariLike } from '@/lib/device'
import { type StemType } from '@/types/song'
import { MixerIcon, StemIcon } from './StemIcons'

interface TrackSelectorProps {
  onSetStemVolume: (stemName: string, volume: number) => void
  stemVolumes?: Record<string, number>
  availableStems: Record<string, string | null>
  stemTypes: StemType[]
  isDisabled?: boolean
}

/**
 * Stem mixer dropdown with per-stem mute controls and volume sliders. All
 * available stems load at full volume by default.
 */
export function TrackSelector({
  onSetStemVolume,
  stemVolumes,
  availableStems,
  stemTypes,
  isDisabled = false,
}: TrackSelectorProps) {
  const showSilentModeWarning = useMemo(() => isAppleMobileSafariLike(), [])
  const availableStemNames = stemTypes.flatMap(({ name }) => availableStems[name] ? [name] : [])
  const hasAudibleStem = availableStemNames.some((name) => (stemVolumes?.[name] ?? 1) > 0)

  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          className={cn(
            'inline-flex h-20 w-full flex-col items-center justify-center gap-1 rounded-2xl border bg-[#111215] text-flame-300 shadow-[0_12px_28px_rgba(0,0,0,0.34)] backdrop-blur transition-colors',
            isDisabled
              ? 'cursor-not-allowed border-white/10 opacity-50'
              : 'border-white/10 hover:border-flame-400/30 hover:text-flame-400',
            'focus:outline-none focus:ring-2 focus:ring-flame-400/40 focus:ring-offset-1 focus:ring-offset-charcoal-800',
          )}
          title="Stem mixer"
          aria-label="Open stem mixer"
          data-testid="track-selector"
          disabled={isDisabled}
        >
          <MixerIcon size={31} />
          <span className="text-[11px] font-medium text-smoke-200">Mixer</span>
        </button>
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Content
          side="top"
          sideOffset={8}
          align="center"
          collisionPadding={8}
          className={cn(
            'z-50 flex flex-col rounded-[1.35rem] border border-flame-400/25 bg-charcoal-950/92 shadow-[0_0_44px_rgba(250,204,21,0.16),0_26px_80px_rgba(0,0,0,0.45)] backdrop-blur-2xl',
            'max-h-[var(--radix-popover-content-available-height)] w-72 max-w-[calc(100vw-1rem)]',
            'animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95',
          )}
        >
          <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-2">
            <button
              type="button"
              onClick={() => {
                const nextVolume = hasAudibleStem ? 0 : 1
                availableStemNames.forEach((name) => onSetStemVolume(name, nextVolume))
              }}
              disabled={availableStemNames.length === 0}
              className="mx-1 mb-1 inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/10 px-3 py-2 text-sm font-medium text-smoke-100 transition-colors hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-flame-400/60 disabled:cursor-not-allowed disabled:opacity-40"
              aria-label={hasAudibleStem ? 'Mute all stems' : 'Unmute all stems'}
              data-testid="track-selector-toggle-all"
            >
              {hasAudibleStem ? <VolumeX size={16} aria-hidden="true" /> : <Volume2 size={16} aria-hidden="true" />}
              {hasAudibleStem ? 'Mute all' : 'Unmute all'}
            </button>

            {showSilentModeWarning && (
              <div
                className="mx-1 mb-1 rounded-lg border border-amber-400/25 bg-amber-400/10 px-3 py-2 text-xs leading-relaxed text-amber-100"
                role="note"
                data-testid="track-selector-silent-mode-warning"
              >
                On iPhone Safari, turn Silent Mode off with the side sound switch so muted-stem mixes are audible.
              </div>
            )}

            {stemTypes.map(({ name, label }) => {
              const available = !!availableStems[name]
              const volume = stemVolumes?.[name] ?? 1

              return (
                <div
                  key={name}
                  className={cn(
                    'flex flex-col gap-1.5 rounded-2xl border border-white/10 bg-white/[0.045] px-3 py-2',
                    !available && 'opacity-40',
                  )}
                  data-testid={`track-selector-stem-${name}`}
                >
                  <div className="flex items-center gap-2 text-sm text-smoke-200">
                    <StemIcon stem={name} size={20} />
                    <span className="font-medium">{label}</span>
                    <button
                      type="button"
                      onClick={() => onSetStemVolume(name, volume > 0 ? 0 : 1)}
                      disabled={!available}
                      className="ml-auto grid size-9 place-items-center rounded-full border border-white/10 bg-white/10 text-smoke-200 transition-colors hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-flame-400/60 disabled:cursor-not-allowed disabled:opacity-50"
                      aria-label={volume > 0 ? `Mute ${label}` : `Unmute ${label}`}
                      data-testid={`track-selector-mute-${name}`}
                    >
                      {volume > 0 ? <VolumeX size={14} aria-hidden="true" /> : <Volume2 size={14} aria-hidden="true" />}
                    </button>
                    <span className="w-9 text-right text-[11px] font-mono tabular-nums text-smoke-400">
                      {Math.round(volume * 100)}%
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={volume}
                    disabled={!available}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                      onSetStemVolume(name, Number(e.target.value))
                    }
                    className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-white/15 accent-flame-400 disabled:cursor-not-allowed"
                    aria-label={`${label} volume`}
                    data-testid={`track-selector-volume-${name}`}
                  />
                </div>
              )
            })}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

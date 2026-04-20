import * as Popover from '@radix-ui/react-popover'
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
 * Stem mixer dropdown — shows a per-stem volume slider. All stems are loaded
 * at full volume by default; users mute a stem by dragging its slider to 0.
 */
export function TrackSelector({
  onSetStemVolume,
  stemVolumes,
  availableStems,
  stemTypes,
  isDisabled = false,
}: TrackSelectorProps) {
  const showSilentModeWarning = useMemo(() => isAppleMobileSafariLike(), [])

  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          className={cn(
            'inline-flex h-16 w-16 items-center justify-center rounded-lg border bg-charcoal-700 text-flame-400/70 transition-colors',
            isDisabled
              ? 'cursor-not-allowed border-charcoal-700 opacity-50'
              : 'border-charcoal-600 hover:border-flame-400/30 hover:text-flame-400',
            'focus:outline-none focus:ring-2 focus:ring-flame-400/40 focus:ring-offset-1 focus:ring-offset-charcoal-800',
          )}
          title="Stem mixer"
          aria-label="Open stem mixer"
          data-testid="track-selector"
          disabled={isDisabled}
        >
          <MixerIcon size={48} />
        </button>
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Content
          side="top"
          sideOffset={8}
          align="center"
          collisionPadding={8}
          className={cn(
            'z-50 flex flex-col rounded-xl border border-charcoal-600 bg-charcoal-800 shadow-xl',
            'max-h-[var(--radix-popover-content-available-height)] w-72 max-w-[calc(100vw-1rem)]',
            'animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95',
          )}
        >
          <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-2">
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
                    'flex flex-col gap-1.5 rounded-lg px-3 py-2',
                    !available && 'opacity-40',
                  )}
                  data-testid={`track-selector-stem-${name}`}
                >
                  <div className="flex items-center gap-2 text-sm text-smoke-200">
                    <StemIcon stem={name} size={20} />
                    <span className="font-medium">{label}</span>
                    <span className="ml-auto w-9 text-right text-[11px] font-mono tabular-nums text-smoke-400">
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
                    className="h-1 w-full cursor-pointer appearance-none rounded-full bg-charcoal-600 accent-flame-500 disabled:cursor-not-allowed"
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

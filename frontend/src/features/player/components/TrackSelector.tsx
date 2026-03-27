import * as Popover from '@radix-ui/react-popover'
import { cn } from '@/lib/cn'
import { type StemType } from '@/types/song'
import { MixerIcon, StemIcon } from './StemIcons'

interface TrackSelectorProps {
  activeStems: string[]
  isFullSong: boolean
  onToggleStem: (stem: string) => void
  onSelectFullSong: () => void
  availableStems: Record<string, string | null>
  stemTypes: StemType[]
}

/**
 * Stem mixer dropdown — lets users toggle individual stems on/off or switch to full song.
 * Uses a Radix Popover with a multi-select list of stems.
 */
export function TrackSelector({
  activeStems,
  isFullSong,
  onToggleStem,
  onSelectFullSong,
  availableStems,
  stemTypes,
}: TrackSelectorProps) {
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          className={cn(
            'inline-flex items-center justify-center rounded-lg w-16 h-16',
            'bg-charcoal-700 border border-charcoal-600 text-flame-400/70',
            'hover:border-flame-400/30 hover:text-flame-400 transition-colors',
            'focus:outline-none focus:ring-2 focus:ring-flame-400/40 focus:ring-offset-1 focus:ring-offset-charcoal-800',
          )}
          title="Stem mixer"
          aria-label="Open stem mixer"
          data-testid="track-selector"
        >
          <MixerIcon size={48} />
        </button>
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Content
          side="top"
          sideOffset={8}
          align="center"
          className={cn(
            'w-56 rounded-xl border border-charcoal-600 bg-charcoal-800 shadow-xl z-50',
            'animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95',
          )}
        >
          <div className="p-2">
            {/* Full Song option */}
            <button
              type="button"
              onClick={onSelectFullSong}
              className={cn(
                'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors',
                isFullSong
                  ? 'bg-flame-400/15 text-flame-400'
                  : 'text-smoke-200 hover:bg-charcoal-700 hover:text-smoke-100',
              )}
              data-testid="track-selector-full-song"
            >
              <StemIcon stem="full_mix" size={24} />
              <span className="font-medium">Full Song</span>
              {isFullSong && (
                <span className="ml-auto text-flame-400" aria-hidden="true">&#10003;</span>
              )}
            </button>

            {/* Separator */}
            <div className="mx-3 my-1 h-px bg-charcoal-600" />

            {/* Individual stems */}
            {stemTypes.map(({ name, label }) => {
              const available = !!availableStems[name]
              const active = activeStems.includes(name)

              return (
                <button
                  key={name}
                  type="button"
                  disabled={!available}
                  onClick={() => onToggleStem(name)}
                  className={cn(
                    'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors',
                    !available && 'opacity-40 cursor-not-allowed',
                    available && active && 'bg-flame-400/15 text-flame-400',
                    available && !active && 'text-smoke-200 hover:bg-charcoal-700 hover:text-smoke-100',
                  )}
                  data-testid={`track-selector-stem-${name}`}
                >
                  <StemIcon stem={name} size={24} />
                  <span className="font-medium">{label}</span>
                  {/* Toggle indicator */}
                  <span
                    className={cn(
                      'ml-auto relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors',
                      active ? 'bg-flame-500' : 'bg-charcoal-600',
                      !available && 'opacity-50',
                    )}
                    aria-hidden="true"
                  >
                    <span
                      className={cn(
                        'pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform',
                        active ? 'translate-x-4' : 'translate-x-0',
                      )}
                    />
                  </span>
                </button>
              )
            })}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

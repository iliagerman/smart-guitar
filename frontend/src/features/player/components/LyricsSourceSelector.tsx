import * as Popover from '@radix-ui/react-popover'
import { Captions } from 'lucide-react'
import { useState } from 'react'

import { cn } from '@/lib/cn'
import type { LyricsSourceMode } from '@/stores/player-prefs.store'

import type { LyricsSourceOption } from '../lib/lyrics-sources'
import { dockPillClass, dockPopoverClass } from '../lib/dock-button'

interface LyricsSourceSelectorProps {
  options: LyricsSourceOption[]
  selected: LyricsSourceMode
  onSelect: (mode: LyricsSourceMode) => void
}

/**
 * Independent lyrics source selector. Keeps lyric switching separate from the
 * sheet source because some songs need different lyric sources for better sync.
 */
export function LyricsSourceSelector({
  options,
  selected,
  onSelect,
}: LyricsSourceSelectorProps) {
  const [open, setOpen] = useState(false)
  const current = options.find((option) => option.key === selected) ?? options[0]

  if (options.length <= 1 || !current) {
    return null
  }

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          className={dockPillClass(open, 'h-9 px-3 text-xs max-sm:px-2.5')}
          title={`Lyrics: ${current.label}`}
          aria-label={`Lyrics source: ${current.label}`}
          data-tour="lyrics-source"
          data-testid="lyrics-source-selector-trigger"
        >
          <Captions size={16} className="text-smoke-300" aria-hidden="true" />
          <span className="truncate max-sm:hidden">Lyrics · {current.label}</span>
        </button>
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Content
          side="bottom"
          sideOffset={8}
          align="end"
          collisionPadding={12}
          className={cn(
            'w-64', dockPopoverClass,
            'animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95',
          )}
        >
          <div className="p-2" data-testid="lyrics-source-selector-popover">
            <div className="px-3 pb-1 text-[11px] uppercase tracking-[0.14em] text-smoke-500">
              Lyrics source
            </div>
            <div className="space-y-1">
              {options.map((option) => {
                const isSelected = option.key === current.key
                return (
                  <button
                    key={option.key}
                    type="button"
                    onClick={() => {
                      onSelect(option.key)
                      setOpen(false)
                    }}
                    className={cn(
                      'flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition-colors',
                      isSelected
                        ? 'bg-fire-500/15 text-fire-200'
                        : 'text-smoke-200 hover:bg-white/[0.06] hover:text-smoke-50',
                    )}
                    data-testid={`lyrics-source-selector-${option.key}`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="font-medium">{option.label}</div>
                      <div className={cn('text-xs', isSelected ? 'text-flame-200/85' : 'text-smoke-500')}>
                        {option.description}
                      </div>
                    </div>
                    {isSelected && <span className="ml-auto pt-0.5" aria-hidden="true">&#10003;</span>}
                  </button>
                )
              })}
            </div>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

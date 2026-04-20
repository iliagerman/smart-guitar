import * as Popover from '@radix-ui/react-popover'
import { Captions } from 'lucide-react'
import { useState } from 'react'

import { cn } from '@/lib/cn'
import type { LyricsSourceMode } from '@/stores/player-prefs.store'

import type { LyricsSourceOption } from '../lib/lyrics-sources'

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
          className={cn(
            'inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium',
            'bg-charcoal-700 border border-charcoal-600 text-smoke-100',
            'hover:border-flame-400/30 transition-colors',
            'focus:outline-none focus:ring-2 focus:ring-flame-400/40 focus:ring-offset-1 focus:ring-offset-charcoal-800',
          )}
          title={`Lyrics: ${current.label}`}
          aria-label={`Lyrics source: ${current.label}`}
          data-tour="lyrics-source"
          data-testid="lyrics-source-selector-trigger"
        >
          <Captions size={16} className="text-smoke-300" aria-hidden="true" />
          <span className="truncate">Lyrics · {current.label}</span>
        </button>
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Content
          side="top"
          sideOffset={8}
          align="start"
          className={cn(
            'w-64 rounded-xl border border-charcoal-600 bg-charcoal-800 shadow-xl z-50',
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
                        ? 'bg-flame-400/15 text-flame-400'
                        : 'text-smoke-200 hover:bg-charcoal-700 hover:text-smoke-100',
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

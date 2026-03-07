import * as Select from '@radix-ui/react-select'
import { ChevronDown, Loader2, Type } from 'lucide-react'

import { cn } from '@/lib/cn'
import { usePlayerPrefsStore, type LyricsMode } from '@/stores/player-prefs.store'

interface LyricsVersionToggleProps {
  className?: string
  hasQuickLyrics: boolean
  hasPreciseLyrics: boolean
  isPreciseGenerating?: boolean
}

const OPTIONS: { value: LyricsMode; label: string }[] = [
  { value: 'quick', label: 'Quick' },
  { value: 'accurate', label: 'Accurate' },
  { value: 'none', label: 'None' },
]

export function LyricsVersionToggle({
  className,
  hasQuickLyrics,
  hasPreciseLyrics,
  isPreciseGenerating = false,
}: LyricsVersionToggleProps) {
  const lyricsMode = usePlayerPrefsStore((s) => s.lyricsMode)
  const setLyricsMode = usePlayerPrefsStore((s) => s.setLyricsMode)

  const available = OPTIONS.filter((opt) => {
    if (opt.value === 'quick') return hasQuickLyrics
    if (opt.value === 'accurate') return hasPreciseLyrics || isPreciseGenerating
    return true // 'none' is always available
  })

  if (available.length <= 1) return null

  const currentLabel = OPTIONS.find((o) => o.value === lyricsMode)?.label ?? 'None'

  return (
    <div className={className} data-testid="lyrics-mode-toggle">
      <Select.Root value={lyricsMode} onValueChange={(val) => setLyricsMode(val as LyricsMode)}>
        <Select.Trigger
          className={cn(
            'inline-flex items-center justify-between gap-1.5 rounded-lg px-2 py-1 text-xs font-medium',
            'bg-charcoal-700 border border-charcoal-600 text-smoke-100',
            'hover:border-flame-400/30 transition-colors',
            'outline-none focus:ring-1 focus:ring-flame-400/40',
            'w-auto',
          )}
          aria-label="Lyrics mode"
        >
          <span className="flex items-center gap-1.5">
            <Type size={12} className="hidden sm:inline shrink-0" />
            <Select.Value>{currentLabel}</Select.Value>
          </span>
          <Select.Icon>
            <ChevronDown size={12} className="text-smoke-400" />
          </Select.Icon>
        </Select.Trigger>

        <Select.Portal>
          <Select.Content
            className={cn(
              'bg-charcoal-800 border border-charcoal-600 rounded-lg shadow-xl',
              'min-w-(--radix-select-trigger-width) max-h-(--radix-select-content-available-height)',
              'overflow-hidden z-50',
            )}
            position="popper"
            sideOffset={4}
          >
            <Select.Viewport className="p-1">
              {available.map((opt) => {
                const isGeneratingAccurate =
                  opt.value === 'accurate' && isPreciseGenerating && !hasPreciseLyrics
                const isSelected = lyricsMode === opt.value

                return (
                  <Select.Item
                    key={opt.value}
                    value={opt.value}
                    disabled={isGeneratingAccurate}
                    className={cn(
                      'flex items-center gap-2 px-2 py-1.5 rounded-md text-xs cursor-pointer outline-none',
                      'transition-colors',
                      isGeneratingAccurate
                        ? 'text-smoke-500 cursor-not-allowed'
                        : 'text-smoke-100 data-highlighted:bg-flame-400/20 data-highlighted:text-flame-400',
                      isSelected && 'bg-flame-400/20 text-flame-400',
                    )}
                  >
                    <Select.ItemText>
                      <span className="inline-flex items-center gap-1.5">
                        {opt.label}
                        {isGeneratingAccurate && (
                          <Loader2
                            size={10}
                            className="animate-spin text-flame-400"
                            aria-label="Generating"
                          />
                        )}
                      </span>
                    </Select.ItemText>
                  </Select.Item>
                )
              })}
            </Select.Viewport>
          </Select.Content>
        </Select.Portal>
      </Select.Root>
    </div>
  )
}

import * as Select from '@radix-ui/react-select'
import { ChevronDown, Check } from 'lucide-react'

import { cn } from '@/lib/cn'
import { type StemName } from '@/stores/playback.store'
import { type StemType } from '@/types/song'

const STEM_ICON_SRCS: Record<string, string> = {
  full_mix: '/art/stems/full-mix.png',
  vocals: '/art/stems/vocals.png',
  guitar: '/art/stems/guitar.png',
  guitar_removed: '/art/stems/guitar.png',
  vocals_guitar: '/art/stems/vocals.png',
}

const DEFAULT_ICON_SRC = '/art/stems/full-mix.png'

function StemIcon({ stem, size = 14 }: { stem: string; size?: number }) {
  const src = STEM_ICON_SRCS[stem] || DEFAULT_ICON_SRC
  return <img src={src} alt="" className="shrink-0 rounded-sm object-cover" width={size} height={size} />
}

interface TrackSelectorProps {
  activeStem: StemName
  onStemChange: (stem: StemName) => void
  availableStems: Record<string, string | null>
  stemTypes: StemType[]
}

interface StemOption {
  value: string
  label: string
  iconStem: string
  available: boolean
}

function buildStemOptions(stemTypes: StemType[], availableStems: Record<string, string | null>): StemOption[] {
  const fullMix: StemOption = {
    value: 'full_mix',
    label: 'Full Mix',
    iconStem: 'full_mix',
    available: true,
  }

  const stems: StemOption[] = stemTypes.map(({ name, label }) => ({
    value: name,
    label,
    iconStem: name,
    available: !!availableStems[name],
  }))

  return [fullMix, ...stems]
}

export function TrackSelector({ activeStem, onStemChange, availableStems, stemTypes }: TrackSelectorProps) {
  const options = buildStemOptions(stemTypes, availableStems)
  const activeOption = options.find((o) => o.value === activeStem) ?? options[0]

  return (
    <div className="min-w-0" data-testid="track-selector">
      <Select.Root value={activeStem} onValueChange={onStemChange}>
        <Select.Trigger
          className={cn(
            'inline-flex items-center justify-between gap-1.5 rounded-lg px-2 py-1 text-xs font-medium',
            'bg-charcoal-700 border border-charcoal-600 text-smoke-100',
            'hover:border-flame-400/30 transition-colors',
            'focus:outline-none focus:ring-2 focus:ring-flame-400/40 focus:ring-offset-1 focus:ring-offset-charcoal-800',
            'w-auto',
          )}
        >
          <span className="flex items-center gap-1.5 min-w-0">
            <span className="hidden sm:inline-flex">
              <StemIcon stem={activeOption.iconStem} size={12} />
            </span>
            <Select.Value className="truncate" />
          </span>
          <Select.Icon>
            <ChevronDown size={12} className="text-smoke-400" />
          </Select.Icon>
        </Select.Trigger>

        <Select.Portal>
          <Select.Content
            className={cn(
              'bg-charcoal-800 border border-charcoal-600 rounded-lg shadow-xl',
              'w-(--radix-select-trigger-width) max-h-(--radix-select-content-available-height)',
              'overflow-hidden z-50',
              'animate-in fade-in-0 zoom-in-95',
            )}
            position="popper"
            sideOffset={4}
          >
            <Select.Viewport className="p-1 max-h-(--radix-select-content-available-height) overflow-y-auto">
              {options.map((option) => {
                const isActive = option.value === activeStem

                return (
                  <Select.Item
                    key={option.value}
                    value={option.value}
                    disabled={!option.available}
                    className={cn(
                      'relative flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium',
                      'cursor-pointer outline-none transition-colors',
                      'data-highlighted:bg-flame-400/10 data-highlighted:text-flame-300',
                      isActive ? 'bg-flame-400/20 text-flame-400' : 'text-smoke-300',
                      !option.available && 'text-smoke-600 opacity-50 cursor-not-allowed',
                    )}
                    data-testid={`track-selector-${option.value}`}
                  >
                    <span className="hidden sm:inline-flex">
                      <StemIcon stem={option.iconStem} />
                    </span>
                    <Select.ItemText>{option.label}</Select.ItemText>
                    {isActive && (
                      <Select.ItemIndicator className="ml-auto">
                        <Check size={14} className="text-flame-400" />
                      </Select.ItemIndicator>
                    )}
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

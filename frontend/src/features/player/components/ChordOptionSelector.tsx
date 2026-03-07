import * as Select from '@radix-ui/react-select'
import { ChevronDown } from 'lucide-react'

import { cn } from '@/lib/cn'
import { usePlaybackStore } from '@/stores/playback.store'
import { type ChordOption } from '@/types/song'

interface ChordOptionSelectorProps {
  chordOptions: ChordOption[]
  hasTabs?: boolean
}

const STANDARD_VALUE = 'standard'
const TABS_VALUE = 'tabs'

export function ChordOptionSelector({ chordOptions, hasTabs = false }: ChordOptionSelectorProps) {
  const selectedChordOptionIndex = usePlaybackStore((s) => s.selectedChordOptionIndex)
  const setSelectedChordOptionIndex = usePlaybackStore((s) => s.setSelectedChordOptionIndex)
  const sheetMode = usePlaybackStore((s) => s.sheetMode)
  const setSheetMode = usePlaybackStore((s) => s.setSheetMode)

  if (chordOptions.length === 0 && !hasTabs) return null

  const selectedCapo =
    selectedChordOptionIndex !== null ? chordOptions[selectedChordOptionIndex]?.capo ?? 0 : 0

  const value =
    sheetMode === 'tabs'
      ? TABS_VALUE
      : selectedChordOptionIndex !== null
        ? String(selectedChordOptionIndex)
        : STANDARD_VALUE

  function handleValueChange(val: string) {
    if (val === TABS_VALUE) {
      setSheetMode('tabs')
      return
    }

    // Switching away from tabs implies chord/lyrics view.
    setSheetMode('chords')

    if (val === STANDARD_VALUE) {
      setSelectedChordOptionIndex(null)
    } else {
      setSelectedChordOptionIndex(Number(val))
    }
  }

  return (
    <div className="flex items-center gap-2 min-w-0" data-testid="chord-option-selector">
      <Select.Root value={value} onValueChange={handleValueChange}>
        <Select.Trigger
          className={cn(
            'flex items-center justify-between gap-1.5 px-2 py-1 rounded-lg text-xs font-medium',
            'bg-charcoal-700 border border-charcoal-600 text-smoke-100',
            'hover:border-flame-400/30 transition-colors',
            'outline-none focus:ring-1 focus:ring-flame-400/40',
            'w-auto'
          )}
        >
          <Select.Value />
          <Select.Icon>
            <ChevronDown size={12} className="text-smoke-400" />
          </Select.Icon>
        </Select.Trigger>

        <Select.Portal>
          <Select.Content
            className={cn(
              'bg-charcoal-800 border border-charcoal-600 rounded-lg shadow-xl',
              'min-w-(--radix-select-trigger-width) max-h-(--radix-select-content-available-height)',
              'overflow-hidden z-50'
            )}
            position="popper"
            sideOffset={4}
          >
            <Select.Viewport className="p-1 max-h-(--radix-select-content-available-height) overflow-y-auto whitespace-nowrap">
              {/* Tabs option disabled */}

              <Select.Item
                value={STANDARD_VALUE}
                className={cn(
                  'flex items-center gap-2 px-3 py-2 rounded-md text-sm cursor-pointer outline-none',
                  'text-smoke-100 transition-colors',
                  'data-highlighted:bg-flame-400/20 data-highlighted:text-flame-400'
                )}
              >
                <Select.ItemText>Standard</Select.ItemText>
              </Select.Item>

              {chordOptions.map((option, index) => (
                <Select.Item
                  key={index}
                  value={String(index)}
                  className={cn(
                    'flex items-center gap-2 px-3 py-2 rounded-md text-sm cursor-pointer outline-none',
                    'text-smoke-100 transition-colors',
                    'data-highlighted:bg-flame-400/20 data-highlighted:text-flame-400'
                  )}
                >
                  <Select.ItemText>
                    <span className="flex items-center gap-2">
                      <span>{option.name}</span>
                      {option.capo > 0 && (
                        <span className="bg-flame-400/20 text-flame-400 text-xs px-1.5 py-0.5 rounded">
                          Capo {option.capo}
                        </span>
                      )}
                    </span>
                  </Select.ItemText>
                </Select.Item>
              ))}
            </Select.Viewport>
          </Select.Content>
        </Select.Portal>
      </Select.Root>

      {sheetMode === 'chords' && selectedCapo > 0 && (
        <span className="bg-flame-400/20 text-flame-400 text-xs px-1.5 py-0.5 rounded">
          Capo {selectedCapo}
        </span>
      )}
    </div>
  )
}

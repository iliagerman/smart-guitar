import { cn } from '@/lib/cn'
import type { ChordOption } from '@/types/song'

import { getSheetVersionDescription, getSheetVersionLabel } from '../lib/sheet-versions'

interface SheetSourceTabsProps {
  versions: ChordOption[]
  selectedIndex: number
  onSelect: (index: number) => void
}

/** "Community chord sheet (Key: Bm) · synced" → "Bm". */
function sheetKey(option: ChordOption): string | null {
  return option.description?.match(/Key: ([^)]+)\)/)?.[1] ?? null
}

/**
 * Where the chords come from, as tabs on top of the sheet: detected from the
 * recording, the community sheets, or your own version. One tap switches.
 */
export function SheetSourceTabs({ versions, selectedIndex, onSelect }: SheetSourceTabsProps) {
  if (versions.length === 0) return null
  const selected = Math.min(selectedIndex, versions.length - 1)

  return (
    <div className="flex min-w-0 flex-1 items-center gap-2" data-testid="sheet-source-tabs">
      <span className="hidden shrink-0 font-mono text-[10px] font-semibold uppercase tracking-[0.22em] text-fire-300 sm:inline">
        Chords
      </span>
      <div
        role="radiogroup"
        aria-label="Chord source"
        className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto rounded-full border border-white/10 bg-black/30 p-0.5 scrollbar-hide"
      >
        {versions.map((version, index) => {
          const isSelected = index === selected
          const key = sheetKey(version)
          return (
            <button
              key={version.version_key ?? `${version.name}-${index}`}
              type="button"
              role="radio"
              aria-checked={isSelected}
              onClick={() => onSelect(index)}
              title={getSheetVersionDescription(version)}
              className={cn(
                // Tabs share the row; a long list scrolls instead of squeezing labels.
                'flex flex-1 items-center justify-center gap-1 whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-bold transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-flame-400/60',
                isSelected
                  ? 'bg-gradient-to-br from-fire-400 to-fire-600 text-white shadow-[0_4px_14px_rgba(249,115,22,0.4)]'
                  : 'text-smoke-300 hover:bg-white/[0.07] hover:text-smoke-50',
              )}
              data-testid={`sheet-source-tab-${index}`}
            >
              {getSheetVersionLabel(version, index)}
              {key && <span className={cn('font-mono text-[10px]', isSelected ? 'text-white/75' : 'text-smoke-500')}>{key}</span>}
            </button>
          )
        })}
      </div>
    </div>
  )
}

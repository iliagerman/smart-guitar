import { Guitar, Trash2 } from 'lucide-react'

import { cn } from '@/lib/cn'
import type { ChordOption } from '@/types/song'

interface ChordVersionToggleProps {
  className?: string
  versions: ChordOption[]
  selectedIndex: number
  currentUserEmail?: string
  upgrading?: boolean
  onSelect: (index: number) => void
  onDelete?: () => void
}

export function ChordVersionToggle({
  className,
  versions,
  selectedIndex,
  currentUserEmail,
  upgrading,
  onSelect,
  onDelete,
}: ChordVersionToggleProps) {
  // Show the toggle when upgrading (even with only 1 version) to display the pending V2
  if (versions.length < 2 && !upgrading) return null

  const clampedIndex = Math.min(selectedIndex, versions.length - 1)
  const current = versions[clampedIndex] ?? versions[0]
  const label = `V${clampedIndex + 1}`
  const isOwned = currentUserEmail && current.created_by === currentUserEmail

  function cycleNext() {
    const nextIdx = (clampedIndex + 1) % versions.length
    onSelect(nextIdx)
  }

  return (
    <div className="relative inline-flex gap-1.5">
      <button
        type="button"
        className={cn(
          'inline-flex items-center justify-center rounded-lg w-16 h-16 relative',
          'bg-charcoal-700 border',
          isOwned
            ? 'border-emerald-400/60 text-emerald-400/80 hover:text-emerald-400 hover:border-emerald-400'
            : 'border-charcoal-600 text-flame-400/70 hover:text-flame-400 hover:border-flame-400/30',
          'transition-colors',
          'focus:outline-none focus:ring-2 focus:ring-flame-400/40 focus:ring-offset-1 focus:ring-offset-charcoal-800',
          className,
        )}
        onClick={cycleNext}
        title={`${current?.name ?? 'Chords'}. Click to switch.`}
        aria-label={`Version: ${label}`}
        data-testid="chord-version-toggle"
      >
        <div className="flex flex-col items-center gap-0.5">
          <Guitar size={24} />
          <span className="text-[10px] font-bold leading-none">{label}</span>
        </div>
      </button>
      {isOwned && onDelete && (
        <button
          type="button"
          onClick={(e: React.MouseEvent<HTMLButtonElement>) => {
            e.stopPropagation()
            onDelete()
          }}
          className="absolute -bottom-2 -right-2 z-10 flex items-center justify-center w-7 h-7 rounded-full bg-red-500/90 text-white hover:bg-red-500 transition-colors shadow-md"
          aria-label="Delete your chord version"
          data-testid="chord-version-delete"
        >
          <Trash2 size={16} />
        </button>
      )}
      {upgrading && versions.length < 2 && (
        <div
          className="inline-flex items-center justify-center rounded-lg w-16 h-16 relative bg-charcoal-700 border border-charcoal-600 opacity-50 pointer-events-none"
          aria-label="Gemini version loading"
          data-testid="chord-version-upgrading"
        >
          <div className="flex flex-col items-center gap-0.5 text-flame-400/50">
            <Guitar size={24} />
            <span className="text-[10px] font-bold leading-none">V2</span>
          </div>
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-smoke-600 border-t-flame-400" />
          </div>
        </div>
      )}
    </div>
  )
}

import { cn } from '@/lib/cn'
import { useFavoritesSortStore, type FavoritesSortMode } from '@/stores/favorites-sort.store'

interface SortOption {
  mode: FavoritesSortMode
  label: string
  testId: string
}

const SORT_OPTIONS: SortOption[] = [
  { mode: 'recent', label: 'Recently added', testId: 'favorites-sort-recent' },
  { mode: 'most_played', label: 'Most played', testId: 'favorites-sort-most-played' },
]

interface FavoritesSortControlProps {
  className?: string
}

/**
 * Segmented control for choosing how the favorites list is ordered.
 * The selection is persisted (via `useFavoritesSortStore`) across sessions.
 */
export function FavoritesSortControl({ className }: FavoritesSortControlProps) {
  const sortMode = useFavoritesSortStore((s) => s.sortMode)
  const setSortMode = useFavoritesSortStore((s) => s.setSortMode)

  return (
    <div
      role="group"
      aria-label="Sort favorites"
      className={cn(
        'inline-flex items-center gap-1 rounded-full border border-white/15 bg-white/[0.05] p-1',
        className,
      )}
      data-testid="favorites-sort-control"
    >
      {SORT_OPTIONS.map((option) => {
        const isActive = sortMode === option.mode
        return (
          <button
            key={option.mode}
            type="button"
            onClick={() => setSortMode(option.mode)}
            aria-pressed={isActive}
            className={cn(
              'rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-flame-400/40 focus-visible:ring-offset-1 focus-visible:ring-offset-charcoal-800',
              isActive
                ? 'border border-flame-400/30 bg-flame-400/15 text-flame-300'
                : 'border border-transparent text-smoke-400 hover:text-smoke-200',
            )}
            data-testid={option.testId}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

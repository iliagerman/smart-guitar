import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/cn'

interface PaginationProps {
  offset: number
  limit: number
  total: number
  onPageChange: (newOffset: number) => void
  className?: string
}

export function Pagination({ offset, limit, total, onPageChange, className }: PaginationProps) {
  if (total <= limit) return null

  const start = offset + 1
  const end = Math.min(offset + limit, total)
  const hasPrev = offset > 0
  const hasNext = offset + limit < total

  return (
    <div
      className={cn(
        'flex items-center justify-between mt-4 px-3 py-2.5 bg-charcoal-800/60 backdrop-blur-sm border border-charcoal-700/50 rounded-xl',
        className,
      )}
    >
      <span className="text-sm text-smoke-400">
        {start}–{end} of {total}
      </span>
      <div className="flex items-center gap-1">
        <button
          onClick={() => onPageChange(Math.max(0, offset - limit))}
          disabled={!hasPrev}
          className="p-1.5 rounded-lg text-smoke-400 hover:text-smoke-100 hover:bg-charcoal-700/60 disabled:opacity-30 disabled:pointer-events-none transition-colors"
          aria-label="Previous page"
        >
          <ChevronLeft size={18} />
        </button>
        <button
          onClick={() => onPageChange(offset + limit)}
          disabled={!hasNext}
          className="p-1.5 rounded-lg text-smoke-400 hover:text-smoke-100 hover:bg-charcoal-700/60 disabled:opacity-30 disabled:pointer-events-none transition-colors"
          aria-label="Next page"
        >
          <ChevronRight size={18} />
        </button>
      </div>
    </div>
  )
}

import type { SearchResult } from '@/types/song'
import { formatDuration } from '@/lib/format-duration'
import { slugToTitleCase } from '@/lib/format-song'
import { Flame, Check } from 'lucide-react'

interface SearchResultCardProps {
  result: SearchResult
  onSelect: (result: SearchResult) => void
  isSelecting?: boolean
  isActive?: boolean
  downloadLabel?: string
}

export function SearchResultCard({ result, onSelect, isSelecting, isActive, downloadLabel }: SearchResultCardProps) {
  const showSpinner = !!isSelecting && !!isActive

  return (
    <button
      onClick={() => onSelect(result)}
      disabled={isSelecting}
      className="w-full flex items-center gap-3 p-3 bg-charcoal-800/60 backdrop-blur-sm border border-charcoal-700/50 rounded-xl hover:bg-charcoal-800/80 hover:border-flame-400/30 hover:shadow-[0_0_20px_rgba(250,204,21,0.08)] transition-all text-left disabled:opacity-50"
      data-testid={`search-result-${result.youtube_id}`}
    >
      <div className="w-12 h-12 rounded-lg bg-charcoal-700/60 overflow-hidden shrink-0">
        {result.thumbnail_url ? (
          <img src={result.thumbnail_url} alt="" className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Flame size={20} className="text-flame-400" />
          </div>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-smoke-100 font-medium truncate">{slugToTitleCase(result.song) || result.title}</p>
        <p className="text-smoke-400 text-sm truncate">{slugToTitleCase(result.artist) || result.artist}</p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {showSpinner && (
          <span className="inline-flex items-center gap-2 text-xs text-smoke-300" aria-live="polite">
            <span className="h-3.5 w-3.5 rounded-full border-2 border-charcoal-600 border-t-flame-400 animate-spin" />
            <span className="hidden sm:inline">{downloadLabel ?? 'Downloading…'}</span>
          </span>
        )}
        {result.exists_locally && (
          <Check size={16} className="text-flame-400" />
        )}
        {result.duration_seconds && (
          <span className="text-smoke-500 text-xs font-mono bg-charcoal-700 px-2 py-1 rounded">
            {formatDuration(result.duration_seconds)}
          </span>
        )}
        <Flame size={16} className="text-flame-400/60" />
      </div>
    </button>
  )
}

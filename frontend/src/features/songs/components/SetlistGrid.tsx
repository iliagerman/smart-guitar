import { Link } from 'react-router-dom'
import { setlistPath } from '@/router/routes'
import { DifficultyBadge } from '@/features/library/components/DifficultyBadge'
import { Skeleton } from '@/components/shared/Skeleton'
import type { Setlist } from '@/types/practice'

interface SetlistGridProps {
  setlists: Setlist[] | undefined
  isLoading: boolean
}

/** Curated, instantly playable setlists — the library as a reason to come back. */
export function SetlistGrid({ setlists, isLoading }: SetlistGridProps) {
  if (isLoading && !setlists) {
    return (
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
        {Array.from({ length: 4 }).map((_, i) => (
          // oxlint-disable-next-line react-doctor/no-array-index-key
          <Skeleton key={i} className="h-36 rounded-2xl" />
        ))}
      </div>
    )
  }

  return (
    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3" data-testid="setlist-grid">
      {(setlists ?? []).map((setlist) => (
        <Link
          key={setlist.id}
          to={setlistPath(setlist.id)}
          className="overflow-hidden rounded-2xl border border-white/10 bg-stage-900 transition-[border-color,transform] hover:-translate-y-0.5 hover:border-fire-500/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-flame-400/60"
          data-testid={`setlist-card-${setlist.id}`}
        >
          <div className="flex h-16 bg-gradient-to-br from-fire-900 to-fire-600">
            {setlist.cover_urls.slice(0, 3).map((url) => (
              <img key={url} src={url} alt="" loading="lazy" className="h-full min-w-0 flex-1 object-cover" onError={(e) => { e.currentTarget.style.visibility = 'hidden' }} />
            ))}
          </div>
          <div className="p-2.5">
            <p className="font-display text-lg leading-none tracking-wide text-smoke-100">{setlist.title.toUpperCase()}</p>
            <p className="mt-1 line-clamp-2 text-[11px] leading-snug text-smoke-400">{setlist.description}</p>
            <p className="mt-1.5 flex items-center gap-2 text-[10.5px] text-smoke-400">
              <DifficultyBadge difficulty={setlist.level} />
              {setlist.song_count} {setlist.song_count === 1 ? 'song' : 'songs'}
            </p>
          </div>
        </Link>
      ))}
    </div>
  )
}

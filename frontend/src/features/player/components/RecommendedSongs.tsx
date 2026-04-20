import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useRecommendations } from '../hooks/use-recommendations'
import { songDetailPath } from '@/router/routes'
import { displayArtistName, displaySongTitle, getThumbnailUrl } from '@/lib/format-song'
import { Skeleton } from '@/components/shared/Skeleton'
import type { Song } from '@/types/song'

interface RecommendedSongsProps {
  songId: string
}

interface RecommendedCardProps {
  song: Song
}

function RecommendedCard({ song }: RecommendedCardProps) {
  const thumbnailUrl = getThumbnailUrl(song)
  const [imgFailed, setImgFailed] = useState(false)

  return (
    <Link
      to={songDetailPath(song.id)}
      className="shrink-0 w-14 sm:w-28 group"
      data-testid={`recommended-song-${song.id}`}
    >
      <div className="relative w-14 h-14 sm:w-28 sm:h-28 rounded-lg sm:rounded-xl bg-charcoal-700/60 overflow-hidden mb-1 sm:mb-1.5 ring-1 ring-charcoal-700/50 group-hover:ring-flame-400/20 transition-colors">
        {thumbnailUrl && !imgFailed ? (
          <img
            src={thumbnailUrl}
            alt=""
            className="absolute inset-0 w-full h-full object-cover"
            onError={() => setImgFailed(true)}
          />
        ) : (
          <video
            src="/guitar.mp4"
            autoPlay
            loop
            muted
            playsInline
            aria-hidden="true"
            className="absolute inset-0 w-full h-full object-cover"
          />
        )}
      </div>
      <p className="text-smoke-100 text-[10px] sm:text-xs font-medium truncate">{displaySongTitle(song)}</p>
      <p className="text-smoke-500 text-[9px] sm:text-[10px] truncate">{displayArtistName(song)}</p>
    </Link>
  )
}

/**
 * Horizontal scrollable list of recommended songs, shown below the main
 * song content on the detail page.
 *
 * @example
 * <RecommendedSongs songId={songId} />
 */
export function RecommendedSongs({ songId }: RecommendedSongsProps) {
  const { data: songs, isLoading } = useRecommendations(songId)

  if (isLoading) {
    return (
      <div className="shrink-0 px-4 pt-2 pb-6">
        <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-hide sm:justify-center">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="w-14 h-20 sm:w-28 sm:h-36 shrink-0 rounded-lg" />
          ))}
        </div>
      </div>
    )
  }

  if (!songs?.length) return null

  return (
    <div className="shrink-0 px-4 pt-2 pb-4" data-testid="recommended-songs">
      <div className="flex gap-2 sm:gap-3 overflow-x-auto pb-2 scrollbar-hide sm:justify-center">
        {songs.map((song) => (
          <RecommendedCard key={song.id} song={song} />
        ))}
      </div>
    </div>
  )
}

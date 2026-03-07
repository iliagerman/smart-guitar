import { useState } from 'react'
import { useRecentSongs } from '../hooks/use-recent-songs'
import { Link } from 'react-router-dom'
import { songDetailPath } from '@/router/routes'
import { Flame } from 'lucide-react'
import { Skeleton } from '@/components/shared/Skeleton'
import { displayArtistName, displaySongTitle, getThumbnailUrl } from '@/lib/format-song'
import type { Song } from '@/types/song'

function RecentSongCard({ song }: { song: Song }) {
  const thumbnailUrl = getThumbnailUrl(song)
  const [imgFailed, setImgFailed] = useState(false)

  return (
    <Link
      to={songDetailPath(song.id)}
      className="shrink-0 w-28 group"
    >
      <div className="w-28 h-28 rounded-xl bg-charcoal-700/60 overflow-hidden mb-1.5 ring-1 ring-charcoal-700/50 group-hover:ring-flame-400/20 transition-all">
        {thumbnailUrl && !imgFailed ? (
          <img src={thumbnailUrl} alt="" className="w-full h-full object-cover" onError={() => setImgFailed(true)} />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Flame size={24} className="text-flame-400" />
          </div>
        )}
      </div>
      <p className="text-smoke-100 text-xs font-medium truncate">{displaySongTitle(song)}</p>
      <p className="text-smoke-500 text-[10px] truncate">{displayArtistName(song)}</p>
    </Link>
  )
}

export function RecentSongs() {
  const { data: songs, isLoading } = useRecentSongs(6)

  if (isLoading) {
    return (
      <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-hide">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="w-28 h-36 shrink-0 rounded-lg" />
        ))}
      </div>
    )
  }

  if (!songs?.length) return null

  return (
    <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-hide" data-testid="recent-songs">
      {songs.map((song) => (
        <RecentSongCard key={song.id} song={song} />
      ))}
    </div>
  )
}

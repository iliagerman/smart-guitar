import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Flame } from 'lucide-react'
import { songDetailPath } from '@/router/routes'
import { formatDuration } from '@/lib/format-duration'
import { displayArtistName, displaySongTitle, getThumbnailUrl } from '@/lib/format-song'
import type { Song } from '@/types/song'

interface SongCardProps {
  song: Song
}

export function SongCard({ song }: SongCardProps) {
  const thumbnailUrl = getThumbnailUrl(song)
  const [imgFailed, setImgFailed] = useState(false)

  return (
    <Link
      to={songDetailPath(song.id)}
      className="flex items-center gap-3 p-3 bg-charcoal-800/60 backdrop-blur-sm border border-charcoal-700/50 rounded-xl hover:bg-charcoal-800/80 hover:border-flame-400/30 hover:shadow-[0_0_20px_rgba(250,204,21,0.08)] transition-all"
      data-testid={`song-card-${song.id}`}
    >
      <div className="w-12 h-12 rounded-lg bg-charcoal-700/60 overflow-hidden shrink-0">
        {thumbnailUrl && !imgFailed ? (
          <img src={thumbnailUrl} alt="" className="w-full h-full object-cover" onError={() => setImgFailed(true)} />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Flame size={18} className="text-flame-400" />
          </div>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-smoke-100 text-sm font-medium truncate">{displaySongTitle(song)}</p>
        <p className="text-smoke-400 text-xs truncate">{displayArtistName(song)}</p>
      </div>
      {(song.duration_seconds ?? 0) > 0 && (
        <span className="text-smoke-500 text-xs font-mono shrink-0">
          {formatDuration(song.duration_seconds ?? 0)}
        </span>
      )}
    </Link>
  )
}

import { useState } from 'react'
import { Link } from 'react-router-dom'
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
      className="group flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.075] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.07),0_14px_38px_rgba(0,0,0,0.22)] backdrop-blur-xl transition-[border-color,background-color,box-shadow,transform] hover:-translate-y-0.5 hover:border-flame-400/35 hover:bg-white/[0.105] hover:shadow-[0_0_28px_rgba(250,204,21,0.12),0_18px_45px_rgba(0,0,0,0.28)]"
      data-testid={`song-card-${song.id}`}
    >
      <div className="relative size-14 shrink-0 overflow-hidden rounded-2xl bg-charcoal-700/60 ring-1 ring-white/10 shadow-[0_10px_28px_rgba(0,0,0,0.28)]">
        {thumbnailUrl && !imgFailed ? (
          <img src={thumbnailUrl} alt="" className="absolute inset-0 w-full h-full object-cover" onError={() => setImgFailed(true)} />
        ) : (
          <video src="/guitar.mp4" autoPlay loop muted playsInline tabIndex={-1} aria-hidden="true" className="absolute inset-0 w-full h-full object-cover" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p className="truncate text-base font-bold tracking-[-0.02em] text-smoke-100">{displaySongTitle(song)}</p>
        <p className="truncate text-sm text-smoke-400">{displayArtistName(song)}</p>
      </div>
      {(song.duration_seconds ?? 0) > 0 && (
        <span className="shrink-0 font-mono text-sm font-semibold text-flame-300">
          {formatDuration(song.duration_seconds ?? 0)}
        </span>
      )}
    </Link>
  )
}

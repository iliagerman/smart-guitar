import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Play } from 'lucide-react'
import { songDetailPath } from '@/router/routes'
import { displaySongTitle, getThumbnailUrl } from '@/lib/format-song'
import type { PracticeSongProgress } from '@/types/practice'

interface ContinueCardProps {
  item: PracticeSongProgress
}

/** Notebook card for a song the user already started. */
export function ContinueCard({ item }: ContinueCardProps) {
  const { song } = item
  const [imgFailed, setImgFailed] = useState(false)
  const thumb = getThumbnailUrl(song)
  const shapes = song.easy_chords ?? []

  return (
    <Link
      to={songDetailPath(song.id)}
      className="flex items-center gap-3 rounded-2xl bg-paper-50 p-3 text-ink-900 shadow-[0_14px_38px_rgba(0,0,0,0.3)] transition-transform hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-flame-400/70"
      data-testid={`continue-card-${song.id}`}
    >
      <img
        src={thumb && !imgFailed ? thumb : '/art/album-placeholder.png'}
        alt=""
        width={60}
        height={60}
        onError={() => setImgFailed(true)}
        className="size-15 shrink-0 rounded-xl object-cover"
      />
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-extrabold tracking-[0.12em] text-fire-600">KEEP PLAYING</p>
        <p className="truncate font-serif text-lg font-extrabold leading-tight">{displaySongTitle(song)}</p>
        {shapes.length > 0 && <p className="truncate font-mono text-xs text-ink-600" dir="ltr">{shapes.join(' · ')}</p>}
      </div>
      <span className="grid size-10 shrink-0 place-items-center rounded-full bg-ink-900 text-white" aria-hidden="true">
        <Play size={16} className="ml-0.5" />
      </span>
    </Link>
  )
}

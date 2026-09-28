import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Play } from 'lucide-react'
import { songDetailPath } from '@/router/routes'
import { displaySongTitle, getThumbnailUrl } from '@/lib/format-song'
import { stepInfo } from '@/features/practice/lib/practice-steps'
import type { PracticeSongProgress } from '@/types/practice'

interface ContinueCardProps {
  item: PracticeSongProgress
}

/** Notebook card that picks a song's practice path up where the user left it. */
export function ContinueCard({ item }: ContinueCardProps) {
  const { song, progress } = item
  const [imgFailed, setImgFailed] = useState(false)
  const thumb = getThumbnailUrl(song)
  const step = stepInfo(progress.current_step)
  const done = progress.completed_steps.length

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
        <p className="text-[10px] font-extrabold tracking-[0.12em] text-fire-600">
          CONTINUE · STEP {progress.current_step} OF 4
        </p>
        <p className="truncate font-serif text-lg font-extrabold leading-tight">{displaySongTitle(song)}</p>
        <p className="truncate text-xs text-ink-600">
          {step.title}
          {progress.current_step === 2 && song.easy_chords?.length
            ? `: ${progress.learned_chords.length} of ${song.easy_chords.length} shapes down`
            : ''}
        </p>
        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-paper-200">
          <div className="h-full rounded-full bg-gradient-to-r from-fire-600 to-fire-500" style={{ width: `${(done / 4) * 100}%` }} />
        </div>
      </div>
      <span className="grid size-10 shrink-0 place-items-center rounded-full bg-ink-900 text-white" aria-hidden="true">
        <Play size={16} className="ml-0.5" />
      </span>
    </Link>
  )
}

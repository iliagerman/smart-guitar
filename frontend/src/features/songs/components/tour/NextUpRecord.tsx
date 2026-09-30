import { useState } from 'react'
import { Link } from 'react-router-dom'
import { songDetailPath } from '@/router/routes'
import { displayArtistName, displaySongTitle, getThumbnailUrl } from '@/lib/format-song'
import type { Song } from '@/types/song'
import type { PracticeProgress } from '@/types/practice'

interface NextUpRecordProps {
  song: Song
  /** Present when the user already started this song. */
  progress: PracticeProgress | null
  /** The line above the title; defaults by whether the song was started. */
  eyebrow?: string
}

function Tonearm() {
  return (
    <svg viewBox="0 0 120 220" className="tonearm pointer-events-none absolute -right-10 -top-6 h-[78%] sm:-right-14" aria-hidden="true">
      <circle cx="102" cy="18" r="15" fill="#1b1720" stroke="#3b3342" strokeWidth="3" />
      <circle cx="102" cy="18" r="5" fill="#f97316" />
      <path d="M102 18 L96 150 L70 196" fill="none" stroke="#cfc7bf" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="56" y="188" width="26" height="16" rx="3" transform="rotate(-32 69 196)" fill="#f97316" />
    </svg>
  )
}

/**
 * The next song on a spinning record, with its album art as the label — the
 * one thing to press tonight.
 */
export function NextUpRecord({ song, progress, eyebrow }: NextUpRecordProps) {
  const [artFailed, setArtFailed] = useState(false)
  const art = getThumbnailUrl(song)
  const started = progress !== null && (progress.completed_steps.length > 0 || progress.current_step > 1)
  const shapes = song.easy_chords ?? []

  return (
    <Link
      to={songDetailPath(song.id)}
      className="group grid items-center gap-3 rounded-[2rem] sm:gap-5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-flame-400/70 sm:grid-cols-[auto_minmax(0,1fr)] sm:gap-12 lg:grid-cols-1 lg:gap-8"
      data-testid={started ? `continue-card-${song.id}` : 'first-song-card'}
    >
      <div className="relative mx-auto size-[10.5rem] sm:size-[18rem] xl:size-[20rem]">
        <div className="record-disc absolute inset-0 grid place-items-center">
          <img
            src={art && !artFailed ? art : '/art/album-placeholder.png'}
            alt=""
            width={120}
            height={120}
            onError={() => setArtFailed(true)}
            className="size-[38%] rounded-full object-cover shadow-[0_0_0_6px_rgba(0,0,0,0.55)]"
          />
          <span className="absolute size-[3.5%] rounded-full bg-stage-950 ring-1 ring-white/20" />
        </div>
        <Tonearm />
      </div>

      <div className="min-w-0 text-center sm:text-left lg:text-center">
        <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.28em] text-fire-400">
          {eyebrow ?? (started ? 'Next up · keep playing' : 'Start here · your first song')}
        </p>
        <p className="mt-2 font-display text-[2.4rem] leading-[0.9] tracking-wide text-smoke-100 sm:text-6xl" dir="auto">
          {displaySongTitle(song)}
        </p>
        <p className="mt-1 text-base text-smoke-300">{displayArtistName(song)}</p>
        {shapes.length > 0 && (
          <p className="mt-3 font-mono text-lg font-semibold text-flame-300 sm:mt-4" dir="ltr">
            {shapes.join(' · ')}
            {song.easy_capo ? <span className="text-smoke-400"> · capo {song.easy_capo}</span> : null}
          </p>
        )}
        <span className="mt-4 inline-flex items-center gap-2 rounded-full bg-fire-500 sm:mt-6 px-6 py-3 text-sm font-extrabold text-white shadow-[0_14px_34px_rgba(249,115,22,0.4)] transition-transform group-hover:-translate-y-0.5">
          {started ? 'Keep playing' : 'Play it'}
          <span aria-hidden="true">→</span>
        </span>
      </div>
    </Link>
  )
}

import { useRef, useState, type CSSProperties } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ChevronLeft, Music, Play } from 'lucide-react'
import { cn } from '@/lib/cn'
import { songsApi } from '@/api/songs.api'
import { queryKeys } from '@/api/query-keys'
import { ROUTES, songDetailPath } from '@/router/routes'
import { getScrollableParent } from '@/lib/scroll'
import { formatDuration } from '@/lib/format-duration'
import { displayArtistName, displaySongTitle, getThumbnailUrl } from '@/lib/format-song'
import { DifficultyBadge } from '@/features/library/components/DifficultyBadge'
import { usePracticeSummary } from '@/features/practice/hooks/use-practice-summary'
import { TourBackdrop } from '@/features/songs/components/tour/TourBackdrop'
import { MODE_LABEL, worldFor } from '@/features/songs/components/tour/tour-worlds'
import { Pagination } from '@/components/shared/Pagination'
import { Skeleton } from '@/components/shared/Skeleton'
import { EmptyState } from '@/components/shared/EmptyState'
import type { Song } from '@/types/song'

const PAGE_SIZE = 20

function Cover({ song, className }: { song: Song; className?: string }) {
  const [failed, setFailed] = useState(false)
  const art = getThumbnailUrl(song)
  return (
    <img
      src={art && !failed ? art : '/art/album-placeholder.png'}
      alt=""
      loading="lazy"
      width={160}
      height={160}
      onError={() => setFailed(true)}
      className={cn('object-cover', className)}
    />
  )
}

/** The first covers of the set, fanned out like records on a table. */
function CoverFan({ songs, accent }: { songs: Song[]; accent: string }) {
  const fan = songs.slice(0, 5)
  if (fan.length < 3) return null
  const mid = (fan.length - 1) / 2
  return (
    <div className="relative hidden h-64 w-[26rem] shrink-0 lg:block" aria-hidden="true">
      {fan.map((song, i) => (
        <span
          key={song.id}
          className="setlist-fan-card absolute left-1/2 top-4 block size-44 overflow-hidden rounded-2xl"
          style={{
            '--fan-x': `${(i - mid) * 62}px`,
            '--fan-r': `${(i - mid) * 7}deg`,
            '--fan-y': `${Math.abs(i - mid) * 12}px`,
            zIndex: 10 - Math.abs(Math.round(i - mid)),
            boxShadow: `0 24px 50px rgba(0,0,0,0.55), 0 0 0 1px rgba(255,255,255,0.08), 0 16px 40px -18px ${accent}`,
          } as CSSProperties}
        >
          <Cover song={song} className="h-full w-full" />
        </span>
      ))}
    </div>
  )
}

interface TrackRowProps {
  song: Song
  number: number
  accent: string
  chart: boolean
}

/** One line of the tracklist; the number turns into a play button on hover. */
function TrackRow({ song, number, accent, chart }: TrackRowProps) {
  const shapes = song.easy_chords ?? []
  return (
    <Link
      to={songDetailPath(song.id)}
      className="group grid grid-cols-[2.25rem_3.5rem_minmax(0,1fr)_auto] items-center gap-3 rounded-2xl px-2 py-2 transition-colors hover:bg-white/[0.06] focus-visible:bg-white/[0.06] focus-visible:outline-none sm:grid-cols-[3rem_4rem_minmax(0,1fr)_auto] sm:gap-4 sm:px-3"
      data-testid={`song-card-${song.id}`}
    >
      <span className="relative grid place-items-center">
        <span
          className={cn('font-display leading-none tracking-wide transition-opacity group-hover:opacity-0', chart && number <= 3 ? 'text-4xl' : 'text-2xl text-smoke-400')}
          style={chart && number <= 3 ? { color: accent, textShadow: `0 0 24px ${accent}88` } : undefined}
        >
          {number}
        </span>
        <span className="absolute grid size-9 place-items-center rounded-full bg-fire-500 text-white opacity-0 shadow-[0_8px_24px_rgba(249,115,22,0.5)] transition-opacity group-hover:opacity-100" aria-hidden="true">
          <Play size={15} className="ml-0.5" fill="currentColor" />
        </span>
      </span>
      <span className="block size-14 overflow-hidden rounded-xl bg-stage-800 shadow-[0_10px_24px_rgba(0,0,0,0.45)] ring-1 ring-white/10 sm:size-16">
        <Cover song={song} className="h-full w-full" />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-base font-bold text-smoke-100" dir="auto">{displaySongTitle(song)}</span>
        <span className="block truncate text-sm text-smoke-400" dir="auto">{displayArtistName(song)}</span>
        {shapes.length > 0 && (
          <span className="mt-0.5 flex min-w-0 items-center gap-2">
            {song.difficulty && <DifficultyBadge difficulty={song.difficulty} />}
            <span className="truncate font-mono text-[11px] text-flame-300/90" dir="ltr">
              {shapes.join(' · ')}
              {song.easy_capo ? <span className="text-smoke-500"> · capo {song.easy_capo}</span> : null}
            </span>
          </span>
        )}
      </span>
      {(song.duration_seconds ?? 0) > 0 && (
        <span className="font-mono text-xs text-smoke-500">{formatDuration(song.duration_seconds ?? 0)}</span>
      )}
    </Link>
  )
}

/** One setlist or chart, staged in its own world: a big header, then the tracklist. */
export function SetlistPage() {
  const { setlistId } = useParams<{ setlistId: string }>()
  const [offset, setOffset] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)
  const { data: summary } = usePracticeSummary()
  const level = summary?.skill_level ?? null
  const { data: setlists } = useQuery({
    queryKey: queryKeys.songs.setlists(level),
    queryFn: () => songsApi.setlists(level),
  })
  const setlist = setlists?.find((s) => s.id === setlistId)
  const world = worldFor(setlistId ?? '')
  const isChart = setlist?.kind === 'chart'
  const { data, isLoading, isError } = useQuery({
    queryKey: queryKeys.songs.setlist(setlistId!, offset, PAGE_SIZE),
    queryFn: () => songsApi.setlistSongs(setlistId!, { skip: offset, limit: PAGE_SIZE }),
  })
  const songs = data?.items ?? []
  const firstSong = offset === 0 ? songs[0] : undefined

  const handlePageChange = (next: number) => {
    setOffset(next)
    getScrollableParent(rootRef.current)?.scrollTo({ top: 0 })
  }

  return (
    <div className="relative flex h-full flex-col overflow-hidden bg-stage-950" data-testid="setlist-page">
      <TourBackdrop active={world.scene} />
      <div className="relative z-10 flex-1 min-h-0 overflow-y-auto pb-[calc(5rem+env(safe-area-inset-bottom)+var(--vv-bottom-offset))] lg:pb-0">
        <div ref={rootRef} className="relative mx-auto w-full max-w-5xl px-4 pb-16 pt-6 sm:px-8" data-inview="true">
          <span className="world-ghost" style={{ '--accent-ghost': `${world.accent}40` } as CSSProperties} aria-hidden="true" dir="auto">
            {world.ghost}
          </span>

          <Link
            to={ROUTES.SONGS}
            className="relative inline-flex items-center gap-1 rounded-full border border-white/10 bg-black/30 px-3 py-1.5 text-xs font-semibold text-smoke-300 backdrop-blur-md transition-colors hover:text-smoke-100"
            data-testid="setlist-back-link"
          >
            <ChevronLeft size={14} aria-hidden="true" /> Tonight&apos;s practice
          </Link>

          <header className="relative mt-10 flex items-end justify-between gap-8 sm:mt-14">
            <div className="min-w-0">
              <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.3em]" style={{ color: world.accent }}>
                {isChart ? 'The chart' : 'Setlist'} · {world.place}
              </p>
              {setlist ? (
                <h1
                  className="mt-3 font-display text-6xl leading-[0.86] tracking-wide text-smoke-100 sm:text-8xl"
                  style={{ textShadow: `0 0 46px ${world.accent}55` }}
                  data-testid="setlist-title"
                >
                  {setlist.title.toUpperCase()}
                </h1>
              ) : (
                <Skeleton className="mt-3 h-16 w-72 rounded-xl sm:h-20 sm:w-[28rem]" />
              )}
              {setlist && (
                <>
                  <p className="mt-4 max-w-xl text-base leading-relaxed text-smoke-200">{setlist.description}</p>
                  <p className="mt-3 font-mono text-xs uppercase tracking-[0.18em] text-smoke-400">
                    {setlist.song_count} {setlist.song_count === 1 ? 'song' : 'songs'}
                    {isChart ? '' : ` · ${setlist.level}`} · {MODE_LABEL[setlist.suggested_mode]}
                  </p>
                </>
              )}
              {firstSong && (
                <Link
                  to={songDetailPath(firstSong.id)}
                  className="mt-7 inline-flex items-center gap-2.5 rounded-full bg-fire-500 py-3 pl-4 pr-6 text-sm font-extrabold text-white shadow-[0_14px_36px_rgba(249,115,22,0.42)] transition-transform hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
                  data-testid="setlist-play-first"
                >
                  <span className="grid size-7 place-items-center rounded-full bg-white/20">
                    <Play size={14} className="ml-0.5" fill="currentColor" aria-hidden="true" />
                  </span>
                  <span className="min-w-0 truncate">Start with {displaySongTitle(firstSong)}</span>
                </Link>
              )}
            </div>
            <CoverFan songs={songs} accent={world.accent} />
          </header>

          <div className="relative mt-12 rounded-[1.75rem] border border-white/10 bg-stage-950/60 p-2 shadow-[0_30px_80px_rgba(0,0,0,0.45)] backdrop-blur-xl sm:p-3">
            {isLoading && !data ? (
              <div className="grid gap-2 p-1">
                {Array.from({ length: 8 }).map((_, i) => (
                  // oxlint-disable-next-line react-doctor/no-array-index-key
                  <Skeleton key={i} className="h-[4.5rem] rounded-2xl" />
                ))}
              </div>
            ) : isError || !songs.length ? (
              <EmptyState icon={<Music size={40} />} title="No songs here yet" description="Try another setlist." />
            ) : (
              <>
                <div className="grid gap-0.5" data-testid="setlist-songs">
                  {songs.map((song, i) => (
                    <TrackRow key={song.id} song={song} number={offset + i + 1} accent={world.accent} chart={isChart} />
                  ))}
                </div>
                <Pagination offset={offset} limit={PAGE_SIZE} total={data?.total ?? 0} onPageChange={handlePageChange} className="mx-1 mb-1" />
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

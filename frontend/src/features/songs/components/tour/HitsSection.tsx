import { useCallback, useState, type CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Play } from 'lucide-react'
import { cn } from '@/lib/cn'
import { setlistPath, songDetailPath } from '@/router/routes'
import { displayArtistName, displaySongTitle, getThumbnailUrl } from '@/lib/format-song'
import { useArrived } from '@/features/songs/hooks/use-tour'
import { hitsQuery, useHits, type ChartId } from '@/features/songs/hooks/use-hits'
import type { Song } from '@/types/song'
import { STADIUM } from './tour-worlds'

const CHARTS: { id: ChartId; label: string }[] = [
  { id: 'hits', label: 'Worldwide' },
  { id: 'israeli-hits', label: 'Israeli classics' },
]

const TOP = 10

export function Cover({ song, className }: { song: Song; className?: string }) {
  const [failed, setFailed] = useState(false)
  const art = getThumbnailUrl(song)
  return (
    <img
      src={art && !failed ? art : '/art/album-placeholder.png'}
      alt=""
      loading="lazy"
      width={200}
      height={200}
      onError={() => setFailed(true)}
      className={cn('h-full w-full object-cover', className)}
    />
  )
}

/** A top-ten entry: the chart position in huge outline, the cover leaning on it. */
function RankCard({ song, rank }: { song: Song; rank: number }) {
  return (
    <Link
      to={songDetailPath(song.id)}
      className="hit-card world-reveal group flex shrink-0 snap-start items-end focus-visible:outline-none"
      style={{ '--reveal-delay': `${0.1 + rank * 0.05}s` } as CSSProperties}
      data-testid={`hit-card-${song.id}`}
    >
      <span className="hit-rank" aria-hidden="true">{rank}</span>
      <span className="relative -ml-3 block w-[8.75rem] sm:-ml-4 sm:w-[10.5rem]">
        <span className="hit-cover relative block aspect-square overflow-hidden rounded-2xl bg-stage-800 group-focus-visible:ring-2 group-focus-visible:ring-flame-400/80">
          <Cover song={song} />
          <span className="absolute inset-0 grid place-items-center bg-black/0 transition-colors duration-300 group-hover:bg-black/35">
            <span className="grid size-12 scale-75 place-items-center rounded-full bg-fire-500 text-white opacity-0 shadow-[0_10px_30px_rgba(249,115,22,0.55)] transition-all duration-300 group-hover:scale-100 group-hover:opacity-100">
              <Play size={20} className="ml-0.5" fill="currentColor" aria-hidden="true" />
            </span>
          </span>
        </span>
        <span className="mt-2 block truncate text-sm font-bold text-smoke-100" dir="auto">{displaySongTitle(song)}</span>
        <span className="block truncate text-xs text-smoke-400" dir="auto">{displayArtistName(song)}</span>
        {(song.easy_chords?.length ?? 0) > 0 && (
          <span className="mt-0.5 block truncate font-mono text-[11px] text-flame-300/90" dir="ltr">
            {song.easy_chords?.slice(0, 4).join(' · ')}
          </span>
        )}
      </span>
    </Link>
  )
}

/** One endless row of covers; the second copy makes the loop seamless. */
function MarqueeRow({ songs, reverse }: { songs: Song[]; reverse?: boolean }) {
  if (!songs.length) return null
  return (
    <div className="hits-marquee" data-reverse={reverse ? 'true' : undefined}>
      <div className="hits-marquee-track">
        {[0, 1].map((copy) => (
          <div key={copy} className="flex shrink-0 gap-3 pr-3" aria-hidden={copy === 1 ? 'true' : undefined}>
            {songs.map((song) => (
              <Link
                key={song.id}
                to={songDetailPath(song.id)}
                tabIndex={copy === 1 ? -1 : undefined}
                className="hits-tile group relative block size-[4.75rem] shrink-0 overflow-hidden rounded-xl bg-stage-800 sm:size-24"
                aria-label={`${displaySongTitle(song)} by ${displayArtistName(song)}`}
                title={`${displaySongTitle(song)} · ${displayArtistName(song)}`}
              >
                <Cover song={song} />
                <span className="absolute inset-x-0 bottom-0 translate-y-full bg-gradient-to-t from-black/90 to-transparent px-1.5 pb-1 pt-4 text-[10px] font-bold leading-tight text-white transition-transform duration-300 group-hover:translate-y-0" dir="auto">
                  <span className="line-clamp-2">{displaySongTitle(song)}</span>
                </span>
              </Link>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

interface HitsSectionProps {
  observe: (el: HTMLElement | null) => (() => void) | undefined
}

/**
 * The stadium stop: the songs everyone wants to play, as a top ten and a wall
 * of covers that keeps moving — proof that the song you had in mind is here.
 */
export function HitsSection({ observe }: HitsSectionProps) {
  const queryClient = useQueryClient()
  const [chart, setChart] = useState<ChartId>('hits')
  const { ref: arrivalRef, arrived } = useArrived<HTMLElement>('400px 0px')
  const { data, isError } = useHits(chart)
  const songs = data?.items ?? []
  const top = songs.slice(0, TOP)
  const rest = songs.slice(TOP)
  const half = Math.ceil(rest.length / 2)
  const sectionRef = useCallback(
    (el: HTMLElement | null) => {
      const unobserve = observe(el)
      const unarrive = arrivalRef(el)
      return () => {
        unobserve?.()
        unarrive?.()
      }
    },
    [observe, arrivalRef],
  )

  if (isError) return null

  return (
    <section
      ref={sectionRef}
      data-stop="hits"
      data-inview={arrived}
      aria-labelledby="hits-title"
      className="relative overflow-hidden py-20 sm:py-24"
      style={{ '--accent-ghost': `${STADIUM.accent}40` } as CSSProperties}
      data-testid="hits-section"
    >
      <span className="world-ghost" aria-hidden="true">{STADIUM.ghost}</span>

      <div className="relative z-10 mx-auto w-full max-w-6xl px-5 sm:px-8">
        <div className="flex flex-wrap items-end justify-between gap-5">
          <div>
            <p className="world-reveal font-mono text-[11px] font-semibold uppercase tracking-[0.3em]" style={{ color: STADIUM.accent }}>
              Stop 1 · {STADIUM.place}
            </p>
            <h2
              id="hits-title"
              className="world-reveal mt-3 font-display text-7xl leading-[0.85] tracking-wide text-smoke-100 sm:text-9xl"
              style={{ '--reveal-delay': '0.06s', textShadow: `0 0 50px ${STADIUM.accent}66` } as CSSProperties}
            >
              THE HITS
            </h2>
            <p className="world-reveal mt-4 max-w-xl text-base leading-relaxed text-smoke-200" style={{ '--reveal-delay': '0.12s' } as CSSProperties}>
              The songs every guitar player wants to play. Chords, lyrics and the whole band are ready. Pick one and join in.
            </p>
          </div>

          <div
            role="tablist"
            aria-label="Chart"
            className="world-reveal flex rounded-full border border-white/10 bg-black/40 p-1 backdrop-blur-md"
            style={{ '--reveal-delay': '0.16s' } as CSSProperties}
          >
            {CHARTS.map(({ id, label }) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={chart === id}
                onClick={() => setChart(id)}
                onPointerEnter={() => queryClient.prefetchQuery(hitsQuery(id))}
                className={cn(
                  'rounded-full px-4 py-2 text-xs font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-flame-400/70',
                  chart === id ? 'bg-flame-400 text-stage-950 shadow-[0_0_24px_rgba(251,191,36,0.45)]' : 'text-smoke-300 hover:text-smoke-100',
                )}
                data-testid={`hits-tab-${id}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div
          className="album-strip -mx-5 mt-10 flex snap-x snap-mandatory scroll-px-5 gap-2 overflow-x-auto px-5 pb-4 pt-2 sm:-mx-8 sm:scroll-px-8 sm:gap-4 sm:px-8"
          role="list"
          aria-label="Top ten"
          data-testid="hits-top"
        >
          {top.length
            ? top.map((song, i) => (
                <div role="listitem" key={song.id}>
                  <RankCard song={song} rank={i + 1} />
                </div>
              ))
            : Array.from({ length: 6 }).map((_, i) => (
                // oxlint-disable-next-line react-doctor/no-array-index-key
                <span key={i} className="ml-14 block aspect-square w-[8.75rem] shrink-0 animate-pulse rounded-2xl bg-white/[0.06] sm:ml-20 sm:w-[10.5rem]" />
              ))}
        </div>
      </div>

      {rest.length > 0 && (
        <div className="world-reveal relative z-10 mt-8 space-y-3" style={{ '--reveal-delay': '0.3s' } as CSSProperties}>
          <MarqueeRow songs={rest.slice(0, half)} />
          <MarqueeRow songs={rest.slice(half)} reverse />
        </div>
      )}

      {data && data.total > 0 && (
        <div className="relative z-10 mx-auto mt-10 w-full max-w-6xl px-5 sm:px-8">
          <Link
            to={setlistPath(chart)}
            className="world-reveal inline-flex items-center gap-2 rounded-full bg-flame-400 px-6 py-3 text-sm font-extrabold text-stage-950 shadow-[0_14px_40px_rgba(251,191,36,0.35)] transition-transform hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
            style={{ '--reveal-delay': '0.36s' } as CSSProperties}
            data-testid="hits-all-link"
          >
            See all {data.total} {chart === 'hits' ? 'hits' : 'classics'}
            <span aria-hidden="true">→</span>
          </Link>
        </div>
      )}
    </section>
  )
}

/** Backstage teaser: a hand of famous covers that jumps to the hits. */
export function HitsTeaser({ onJump }: { onJump: () => void }) {
  const { data } = useHits()
  const songs = data?.items?.slice(0, 5) ?? []
  if (!songs.length || !data) return null
  const names = songs.slice(0, 2).map(displaySongTitle)
  return (
    <button
      type="button"
      onClick={onJump}
      className="group inline-flex items-center gap-3 rounded-full border border-white/10 bg-black/35 py-1.5 pl-1.5 pr-5 text-left backdrop-blur-md transition-colors hover:border-flame-400/40 hover:bg-black/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-flame-400/70"
      data-testid="hits-teaser"
    >
      <span className="flex">
        {songs.map((song, i) => (
          <span
            key={song.id}
            className={cn('block size-9 overflow-hidden rounded-full ring-2 ring-stage-950 transition-transform group-hover:-translate-y-0.5', i > 0 && '-ml-3')}
            style={{ transitionDelay: `${i * 40}ms` }}
          >
            <Cover song={song} />
          </span>
        ))}
      </span>
      <span className="min-w-0 text-xs leading-snug text-smoke-300">
        <b className="font-bold text-smoke-100">{names.join(', ')}</b> and {Math.max(data.total - names.length, 0)} more hits
        <span className="block text-flame-300">are ready to play →</span>
      </span>
    </button>
  )
}

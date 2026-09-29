import { useCallback, useState, type CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { songsApi } from '@/api/songs.api'
import { queryKeys } from '@/api/query-keys'
import { setlistPath, songDetailPath } from '@/router/routes'
import { displayArtistName, displaySongTitle, getThumbnailUrl } from '@/lib/format-song'
import { useArrived } from '@/features/songs/hooks/use-tour'
import type { Setlist } from '@/types/practice'
import type { Song } from '@/types/song'
import { MODE_LABEL, type WorldTheme } from './tour-worlds'

const STRIP_SIZE = 12

interface AlbumCardProps {
  song: Song
  index: number
  accent: string
}

function AlbumCard({ song, index, accent }: AlbumCardProps) {
  const [artFailed, setArtFailed] = useState(false)
  const art = getThumbnailUrl(song)
  return (
    <Link
      to={songDetailPath(song.id)}
      className="album-card world-reveal block w-[8.5rem] shrink-0 snap-start rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-flame-400/70 sm:w-[10.5rem]"
      style={{ '--reveal-delay': `${0.15 + index * 0.06}s` } as CSSProperties}
      data-testid={`album-card-${song.id}`}
    >
      <span
        className="block aspect-square overflow-hidden rounded-2xl bg-stage-800"
        style={{ boxShadow: `0 18px 40px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.06), 0 10px 30px -12px ${accent}` }}
      >
        <img
          src={art && !artFailed ? art : '/art/album-placeholder.png'}
          alt=""
          loading="lazy"
          width={168}
          height={168}
          onError={() => setArtFailed(true)}
          className="h-full w-full object-cover"
        />
      </span>
      <span className="mt-2 block truncate text-sm font-bold text-smoke-100">{displaySongTitle(song)}</span>
      <span className="block truncate text-xs text-smoke-400">{displayArtistName(song)}</span>
      {(song.easy_chords?.length ?? 0) > 0 && (
        <span className="mt-0.5 block truncate font-mono text-[11px] text-smoke-300" dir="ltr">
          {song.easy_chords?.slice(0, 5).join(' · ')}
        </span>
      )}
    </Link>
  )
}

interface WorldSectionProps {
  setlist: Setlist
  world: WorldTheme
  stop: number
  observe: (el: HTMLElement | null) => (() => void) | undefined
}

/**
 * One stop of the night tour: a setlist staged as its own world, with the
 * venue word drifting behind and a strip of the setlist's real album covers.
 */
export function WorldSection({ setlist, world, stop, observe }: WorldSectionProps) {
  const { ref: arrivalRef, arrived } = useArrived<HTMLElement>('600px 0px')
  const { data } = useQuery({
    queryKey: queryKeys.songs.setlist(setlist.id, 0, STRIP_SIZE),
    queryFn: () => songsApi.setlistSongs(setlist.id, { skip: 0, limit: STRIP_SIZE }),
    enabled: arrived,
  })
  const songs = data?.items ?? []
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

  return (
    <section
      ref={sectionRef}
      data-stop={setlist.id}
      data-inview={arrived}
      aria-labelledby={`stop-${setlist.id}`}
      className="relative flex min-h-[86svh] items-center overflow-hidden py-20"
      style={{ '--accent-ghost': `${world.accent}48` } as CSSProperties}
      data-testid={`tour-stop-${setlist.id}`}
    >
      <span className="world-ghost" aria-hidden="true" dir="auto">{world.ghost}</span>

      <div className="relative z-10 mx-auto w-full max-w-6xl px-5 sm:px-8">
        <p className="world-reveal font-mono text-[11px] font-semibold uppercase tracking-[0.3em]" style={{ color: world.accent }}>
          Stop {stop} · {world.place}
        </p>
        <h2
          id={`stop-${setlist.id}`}
          className="world-reveal mt-3 max-w-3xl font-display text-6xl leading-[0.88] tracking-wide text-smoke-100 sm:text-8xl"
          style={{ '--reveal-delay': '0.06s', textShadow: `0 0 42px ${world.accent}55` } as CSSProperties}
        >
          {setlist.title.toUpperCase()}
        </h2>
        <p className="world-reveal mt-4 max-w-xl text-base leading-relaxed text-smoke-200" style={{ '--reveal-delay': '0.12s' } as CSSProperties}>
          {setlist.description}
        </p>
        <p className="world-reveal mt-3 font-mono text-xs uppercase tracking-[0.18em] text-smoke-400" style={{ '--reveal-delay': '0.16s' } as CSSProperties}>
          {setlist.song_count} {setlist.song_count === 1 ? 'song' : 'songs'} · {setlist.level} · {MODE_LABEL[setlist.suggested_mode]}
        </p>

        <div
          className="album-strip -mx-5 mt-8 flex snap-x snap-mandatory scroll-px-5 gap-4 overflow-x-auto px-5 pb-3 sm:-mx-8 sm:scroll-px-8 sm:px-8"
          role="list"
          aria-label={`Songs in ${setlist.title}`}
        >
          {songs.length
            ? songs.map((song, i) => (
                <div role="listitem" key={song.id}>
                  <AlbumCard song={song} index={i} accent={world.accent} />
                </div>
              ))
            : Array.from({ length: 6 }).map((_, i) => (
                // oxlint-disable-next-line react-doctor/no-array-index-key
                <span key={i} className="block aspect-square w-[8.5rem] shrink-0 animate-pulse rounded-2xl bg-white/[0.06] sm:w-[10.5rem]" />
              ))}
        </div>

        <Link
          to={setlistPath(setlist.id)}
          className="world-reveal mt-6 inline-flex items-center gap-2 rounded-full border px-5 py-2.5 text-sm font-bold text-smoke-100 transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-flame-400/70"
          style={{ borderColor: `${world.accent}88`, '--reveal-delay': '0.3s' } as CSSProperties}
          data-testid={`setlist-card-${setlist.id}`}
        >
          Open the setlist
          <span aria-hidden="true">→</span>
        </Link>
      </div>
    </section>
  )
}

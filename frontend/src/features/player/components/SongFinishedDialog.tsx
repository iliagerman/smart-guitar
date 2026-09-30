import { useState } from 'react'
import { Link } from 'react-router-dom'
import * as Dialog from '@radix-ui/react-dialog'
import { Play, RotateCcw, X } from 'lucide-react'

import { analyticsTracker } from '@/lib/event-tracker'
import { cn } from '@/lib/cn'
import { displayArtistName, displaySongTitle, getThumbnailUrl } from '@/lib/format-song'
import { songDetailPath } from '@/router/routes'
import type { Song } from '@/types/song'
import { useRecommendations } from '../hooks/use-recommendations'

interface CoverProps {
  song: Song
  className?: string
}

function Cover({ song, className }: CoverProps) {
  const [failed, setFailed] = useState(false)
  const src = getThumbnailUrl(song)
  return (
    <img
      src={src && !failed ? src : '/art/album-placeholder.png'}
      alt=""
      loading="lazy"
      onError={() => setFailed(true)}
      className={cn('shrink-0 rounded-xl object-cover ring-1 ring-white/10', className)}
    />
  )
}

interface SongFinishedDialogProps {
  songId: string
  open: boolean
  onReplay: () => void
  onClose: () => void
}

/**
 * When a song ends: a pat on the back and the next song to play, with a few
 * more to choose from, so the night keeps going.
 */
export function SongFinishedDialog({ songId, open, onReplay, onClose }: SongFinishedDialogProps) {
  const { data: songs } = useRecommendations(songId)
  const [next, ...more] = songs ?? []

  const track = (nextSongId: string, place: 'up_next' | 'more') =>
    analyticsTracker.track({
      event_type: 'song_finished_next_clicked',
      event_category: 'player',
      song_id: songId,
      properties: { next_song_id: nextSongId, place },
    })

  return (
    <Dialog.Root open={open} onOpenChange={(value) => !value && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-1.5rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-[1.75rem] border border-fire-500/25 bg-stage-950/95 p-5 shadow-[0_30px_90px_rgba(0,0,0,0.7),0_0_60px_rgba(249,115,22,0.15)] backdrop-blur-xl sm:p-6"
          data-testid="song-finished"
        >
          <Dialog.Close asChild>
            <button
              type="button"
              className="absolute right-3 top-3 grid size-9 place-items-center rounded-full text-smoke-400 transition-colors hover:bg-white/10 hover:text-smoke-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-flame-400/60"
              aria-label="Close"
            >
              <X size={17} aria-hidden="true" />
            </button>
          </Dialog.Close>
          <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.26em] text-fire-300">Song over</p>
          <Dialog.Title className="mt-1 font-display text-4xl leading-none tracking-wide text-smoke-50">You played it through!</Dialog.Title>
          <Dialog.Description className="mt-2 text-sm text-smoke-300">Keep it going: here&apos;s your next song.</Dialog.Description>

          {next && (
            <div data-testid="recommended-songs">
              <Link
                to={songDetailPath(next.id)}
                onClick={() => track(next.id, 'up_next')}
                className="group mt-4 flex items-center gap-3 rounded-2xl border border-fire-500/30 bg-gradient-to-r from-fire-500/15 to-white/[0.03] p-3 transition-colors hover:border-fire-400/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-flame-400/60"
                data-testid={`recommended-song-${next.id}`}
              >
                <Cover song={next} className="size-16" />
                <div className="min-w-0 flex-1">
                  <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.22em] text-fire-300">Up next</p>
                  <p className="truncate font-display text-2xl leading-tight tracking-wide text-smoke-50" dir="auto">{displaySongTitle(next)}</p>
                  <p className="truncate text-xs text-smoke-400" dir="auto">{displayArtistName(next)}</p>
                </div>
                <span className="grid size-11 shrink-0 place-items-center rounded-full bg-gradient-to-br from-fire-400 to-fire-600 text-white shadow-[0_8px_22px_rgba(249,115,22,0.45)] transition-transform group-hover:scale-105" aria-hidden="true">
                  <Play size={18} className="ml-0.5" fill="currentColor" />
                </span>
              </Link>

              {more.length > 0 && (
                <>
                  <p className="mt-4 text-xs font-semibold text-smoke-400">Or pick another</p>
                  <div className="mt-2 grid grid-cols-3 gap-2">
                    {more.slice(0, 3).map((song) => (
                      <Link
                        key={song.id}
                        to={songDetailPath(song.id)}
                        onClick={() => track(song.id, 'more')}
                        className="min-w-0 rounded-xl p-1 transition-colors hover:bg-white/[0.05] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-flame-400/60"
                        data-testid={`recommended-song-${song.id}`}
                      >
                        <Cover song={song} className="aspect-square w-full" />
                        <p className="mt-1 truncate text-[11px] font-semibold text-smoke-200" dir="auto">{displaySongTitle(song)}</p>
                        <p className="truncate text-[10px] text-smoke-500" dir="auto">{displayArtistName(song)}</p>
                      </Link>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

          <button
            type="button"
            onClick={onReplay}
            className="mt-5 flex w-full items-center justify-center gap-2 rounded-full border border-white/12 py-2.5 text-sm font-semibold text-smoke-200 transition-colors hover:border-fire-400/40 hover:text-smoke-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-flame-400/60"
            data-testid="song-finished-replay"
          >
            <RotateCcw size={15} aria-hidden="true" /> Play it again
          </button>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

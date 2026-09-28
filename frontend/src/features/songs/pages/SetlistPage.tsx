import { useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ChevronLeft, Music } from 'lucide-react'
import { songsApi } from '@/api/songs.api'
import { queryKeys } from '@/api/query-keys'
import { ROUTES } from '@/router/routes'
import { getScrollableParent } from '@/lib/scroll'
import { SongCard } from '@/features/library/components/SongCard'
import { DifficultyBadge } from '@/features/library/components/DifficultyBadge'
import { usePracticeSummary } from '@/features/practice/hooks/use-practice-summary'
import { PageContainer } from '@/components/shared/PageContainer'
import { Pagination } from '@/components/shared/Pagination'
import { Skeleton } from '@/components/shared/Skeleton'
import { EmptyState } from '@/components/shared/EmptyState'

const PAGE_SIZE = 20

const MODE_HINT: Record<string, string> = {
  play_along: 'Open a song and take the guitarist’s seat.',
  drums_bass: 'Open a song, then keep just the drums and bass on stage.',
  learn: 'Open a song and follow its 4 steps, starting with Hear it.',
}

/** One curated setlist: header plus its songs with difficulty and shapes. */
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
  const { data, isLoading, isError } = useQuery({
    queryKey: queryKeys.songs.setlist(setlistId!, offset),
    queryFn: () => songsApi.setlistSongs(setlistId!, { skip: offset, limit: PAGE_SIZE }),
  })

  const handlePageChange = (next: number) => {
    setOffset(next)
    getScrollableParent(rootRef.current)?.scrollTo({ top: 0 })
  }

  return (
    <div className="relative flex h-full flex-col overflow-hidden bg-stage-950" data-testid="setlist-page">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-64 bg-[radial-gradient(90%_100%_at_50%_-20%,rgba(249,115,22,0.3)_0%,transparent_75%)]" aria-hidden="true" />
      <div className="relative flex-1 min-h-0 overflow-y-auto pb-[calc(5rem+env(safe-area-inset-bottom)+var(--vv-bottom-offset))] lg:pb-0">
        <PageContainer>
          <div ref={rootRef}>
            <Link
              to={ROUTES.SONGS}
              className="inline-flex items-center gap-1 text-xs font-semibold text-smoke-400 hover:text-smoke-200"
              data-testid="setlist-back-link"
            >
              <ChevronLeft size={14} aria-hidden="true" /> Tonight&apos;s practice
            </Link>
            <h1 className="mt-3 font-display text-4xl leading-none tracking-wide text-smoke-100" data-testid="setlist-title">
              {(setlist?.title ?? 'Setlist').toUpperCase()}
            </h1>
            {setlist && (
              <>
                <p className="mt-2 max-w-xl text-sm text-smoke-300">{setlist.description}</p>
                <p className="mt-2 flex items-center gap-2 text-xs text-smoke-400">
                  <DifficultyBadge difficulty={setlist.level} />
                  {setlist.song_count} {setlist.song_count === 1 ? 'song' : 'songs'} · {MODE_HINT[setlist.suggested_mode]}
                </p>
              </>
            )}

            <div className="mt-5">
              {isLoading && !data ? (
                <div className="grid grid-cols-1 gap-3">
                  {Array.from({ length: 6 }).map((_, i) => (
                    // oxlint-disable-next-line react-doctor/no-array-index-key
                    <Skeleton key={i} className="h-20 rounded-2xl" />
                  ))}
                </div>
              ) : isError || !data?.items.length ? (
                <EmptyState icon={<Music size={40} />} title="No songs here yet" description="Try another setlist." />
              ) : (
                <>
                  <div className="grid grid-cols-1 gap-3" data-testid="setlist-songs">
                    {data.items.map((song) => <SongCard key={song.id} song={song} />)}
                  </div>
                  <Pagination offset={offset} limit={PAGE_SIZE} total={data.total} onPageChange={handlePageChange} />
                </>
              )}
            </div>
          </div>
        </PageContainer>
      </div>
    </div>
  )
}

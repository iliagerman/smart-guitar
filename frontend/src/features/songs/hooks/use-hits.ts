import { useQuery } from '@tanstack/react-query'
import { songsApi } from '@/api/songs.api'
import { queryKeys } from '@/api/query-keys'

export type ChartId = 'hits' | 'israeli-hits'

/** Enough of a chart for a top ten plus a wall of covers; one cache entry app-wide. */
const CHART_SIZE = 40

export function hitsQuery(chart: ChartId) {
  return {
    queryKey: queryKeys.songs.setlist(chart, 0, CHART_SIZE),
    queryFn: () => songsApi.setlistSongs(chart, { skip: 0, limit: CHART_SIZE }),
    staleTime: 10 * 60 * 1000,
  }
}

/** The most wanted songs of a chart, in chart order. */
export function useHits(chart: ChartId = 'hits') {
  return useQuery({ ...hitsQuery(chart), placeholderData: (previous) => previous })
}

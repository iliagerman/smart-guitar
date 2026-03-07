import { useEffect, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { jobsApi } from '@/api/jobs.api'
import { queryKeys } from '@/api/query-keys'
import type { Job } from '@/types/job'

export function useJobPolling(jobId: string | null) {
  const queryClient = useQueryClient()
  const invalidatedRef = useRef(false)

  const query = useQuery({
    queryKey: queryKeys.jobs.detail(jobId!),
    queryFn: () => jobsApi.get(jobId!),
    enabled: !!jobId,
    refetchInterval: (query) => {
      const data = query.state.data as Job | undefined
      if (data?.status === 'COMPLETED' || data?.status === 'FAILED') {
        return false
      }
      return 10_000
    },
  })

  // Invalidate the song detail query exactly once when the job completes.
  // Previously this lived inside `select`, which is a pure data transformer
  // that runs on every render — creating an infinite invalidation loop.
  useEffect(() => {
    if (query.data?.status === 'COMPLETED' && !invalidatedRef.current) {
      invalidatedRef.current = true
      queryClient.invalidateQueries({
        queryKey: queryKeys.songs.detail(query.data.song_id),
      })
    }
  }, [query.data?.status, query.data?.song_id, queryClient])

  // Reset the guard when jobId changes (e.g. user retries).
  useEffect(() => {
    invalidatedRef.current = false
  }, [jobId])

  return query
}

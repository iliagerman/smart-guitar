import { useQuery } from '@tanstack/react-query'
import { jobsApi } from '@/api/jobs.api'
import { queryKeys } from '@/api/query-keys'

export function useJobStatusUrl(jobId: string | null) {
    return useQuery({
        queryKey: queryKeys.jobs.statusUrl(jobId ?? ''),
        queryFn: () => jobsApi.getStatusUrl(jobId!),
        enabled: !!jobId,
        staleTime: 5 * 60 * 1000,
    })
}

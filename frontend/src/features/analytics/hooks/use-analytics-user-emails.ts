import { useQuery } from '@tanstack/react-query'
import { analyticsApi } from '@/api/analytics.api'
import { queryKeys } from '@/api/query-keys'

export function useAnalyticsUserEmails() {
    return useQuery({
        queryKey: queryKeys.analytics.userEmails(),
        queryFn: () => analyticsApi.userEmails({ days: 365 }),
        staleTime: 1000 * 60 * 30,
    })
}

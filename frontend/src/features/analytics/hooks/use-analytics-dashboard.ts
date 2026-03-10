import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { analyticsApi } from '@/api/analytics.api'
import { queryKeys } from '@/api/query-keys'
import { useAnalyticsFilterStore } from '@/stores/analytics-filter.store'

function toIsoBoundary(date: string, endOfDay = false): string {
    return new Date(`${date}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}`).toISOString()
}

export function useAnalyticsDashboard() {
    const startDate = useAnalyticsFilterStore((s) => s.startDate)
    const endDate = useAnalyticsFilterStore((s) => s.endDate)
    const userEmail = useAnalyticsFilterStore((s) => s.userEmail)

    const params = useMemo(
        () => ({
            since: toIsoBoundary(startDate),
            until: toIsoBoundary(endDate, true),
            granularity: 'day' as const,
            user_email: userEmail || undefined,
        }),
        [endDate, startDate, userEmail],
    )

    const query = useQuery({
        queryKey: queryKeys.analytics.dashboard(params),
        queryFn: () => analyticsApi.dashboard(params),
    })

    return { ...query, params }
}

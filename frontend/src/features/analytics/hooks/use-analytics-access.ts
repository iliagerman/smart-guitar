import { useQuery } from '@tanstack/react-query'
import { analyticsApi } from '@/api/analytics.api'
import { queryKeys } from '@/api/query-keys'
import { useAuthStore } from '@/stores/auth.store'

export function useAnalyticsAccess() {
    const isAuthenticated = useAuthStore((s) => s.isAuthenticated)

    const query = useQuery({
        queryKey: queryKeys.analytics.access(),
        queryFn: analyticsApi.access,
        enabled: isAuthenticated,
        staleTime: 5 * 60 * 1000,
    })

    return {
        ...query,
        isAllowed: isAuthenticated && query.data?.allowed === true,
    }
}
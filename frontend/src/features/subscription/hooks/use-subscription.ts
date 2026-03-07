import { useQuery } from '@tanstack/react-query'
import { useEffect } from 'react'
import { queryKeys } from '@/api/query-keys'
import { subscriptionApi } from '@/api/subscription.api'
import { useSubscriptionStore } from '@/stores/subscription.store'
import { useAuthStore } from '@/stores/auth.store'

export function useSubscription() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const setStatus = useSubscriptionStore((s) => s.setStatus)

  const query = useQuery({
    queryKey: queryKeys.subscription.status(),
    queryFn: subscriptionApi.getStatus,
    enabled: isAuthenticated,
    staleTime: 1000 * 60 * 2, // 2 minutes
    refetchOnWindowFocus: true,
  })

  useEffect(() => {
    if (query.data) {
      setStatus(query.data)
    }
  }, [query.data, setStatus])

  return query
}

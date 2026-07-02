import { QueryClient } from '@tanstack/react-query'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Data is considered fresh for 3 minutes, so mount/reconnect/focus
      // refetches are skipped when the cache is still fresh instead of
      // always firing a network request (queries that genuinely need
      // always-fresh data, like use-song-detail, set their own overrides).
      staleTime: 1000 * 60 * 3,
      retry: 1,
      refetchOnMount: true,
      refetchOnReconnect: true,
      refetchOnWindowFocus: true,
    },
  },
})

export const queryKeys = {
  songs: {
    all: ['songs'] as const,
    list: (query?: string, offset?: number, limit?: number) => ['songs', 'list', { query, offset, limit }] as const,
    detail: (id: string) => ['songs', 'detail', id] as const,
    recent: (limit?: number) => ['songs', 'recent', { limit }] as const,
    search: (query: string) => ['songs', 'search', query] as const,
  },
  jobs: {
    all: ['jobs'] as const,
    detail: (id: string) => ['jobs', 'detail', id] as const,
    list: () => ['jobs', 'list'] as const,
    statusUrl: (id: string) => ['jobs', 'status-url', id] as const,
    statusManifest: (url: string) => ['jobs', 'status-manifest', url] as const,
  },
  favorites: {
    all: ['favorites'] as const,
    list: () => ['favorites', 'list'] as const,
  },
  analytics: {
    all: ['analytics'] as const,
    access: () => ['analytics', 'access'] as const,
    dashboard: (params?: Record<string, unknown>) => ['analytics', 'dashboard', params] as const,
    overview: (params?: Record<string, unknown>) => ['analytics', 'overview', params] as const,
    trends: (params?: Record<string, unknown>) => ['analytics', 'trends', params] as const,
    topSongs: (params?: Record<string, unknown>) => ['analytics', 'top-songs', params] as const,
    users: (params?: Record<string, unknown>) => ['analytics', 'users', params] as const,
    events: (params?: Record<string, unknown>) => ['analytics', 'events', params] as const,
    userEmails: () => ['analytics', 'user-emails'] as const,
  },
  subscription: {
    all: ['subscription'] as const,
    status: () => ['subscription', 'status'] as const,
    prices: () => ['subscription', 'prices'] as const,
  },
} as const

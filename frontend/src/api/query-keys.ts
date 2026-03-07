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
  subscription: {
    all: ['subscription'] as const,
    status: () => ['subscription', 'status'] as const,
    prices: () => ['subscription', 'prices'] as const,
  },
} as const

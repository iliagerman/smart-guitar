import { api } from '../config/api'
import type {
    AnalyticsAccessResponse,
    AnalyticsDashboard,
    AnalyticsOverview,
    AnalyticsQueryParams,
    AnalyticsUserEmailsResponse,
    EventTrend,
    EventTypeBreakdown,
    RecentEvent,
    SongRanking,
    TrackEventsResponse,
    TrackingEvent,
    UserActivity,
} from '../types/analytics'

export const analyticsApi = {
    access: () =>
        api.get<AnalyticsAccessResponse>('/api/v1/analytics/access').then((r) => r.data),

    dashboard: (params?: AnalyticsQueryParams) =>
        api.get<AnalyticsDashboard>('/api/v1/analytics/dashboard', { params }).then((r) => r.data),

    overview: (params?: AnalyticsQueryParams) =>
        api.get<AnalyticsOverview>('/api/v1/analytics/overview', { params }).then((r) => r.data),

    trends: (params?: AnalyticsQueryParams) =>
        api.get<EventTrend[]>('/api/v1/analytics/trends', { params }).then((r) => r.data),

    topSongs: (params?: AnalyticsQueryParams) =>
        api.get<SongRanking[]>('/api/v1/analytics/top-songs', { params }).then((r) => r.data),

    userActivity: (params?: AnalyticsQueryParams) =>
        api.get<UserActivity[]>('/api/v1/analytics/users', { params }).then((r) => r.data),

    recentEvents: (params?: AnalyticsQueryParams) =>
        api.get<RecentEvent[]>('/api/v1/analytics/events', { params }).then((r) => r.data),

    breakdown: (params?: AnalyticsQueryParams) =>
        api.get<EventTypeBreakdown[]>('/api/v1/analytics/breakdown', { params }).then((r) => r.data),

    userEmails: (params?: Pick<AnalyticsQueryParams, 'since' | 'until' | 'days'>) =>
        api.get<AnalyticsUserEmailsResponse>('/api/v1/analytics/user-emails', { params }).then((r) => r.data.items),

    trackBatch: (events: TrackingEvent[]) =>
        api.post<TrackEventsResponse>('/api/v1/analytics/track/batch', { events }).then((r) => r.data),
}

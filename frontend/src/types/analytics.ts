export interface AnalyticsOverview {
    total_events: number
    unique_users: number
    total_sessions: number
    login_count: number
    song_play_count: number
}

export interface TimeBucket {
    bucket_start: string
    count: number
}

export interface EventTrend {
    event_type: string
    buckets: TimeBucket[]
}

export interface SongRanking {
    song_id: string | null
    song_title: string | null
    play_count: number
    unique_users: number
}

export interface UserActivity {
    user_email: string
    event_count: number
    last_seen_at: string
}

export interface EventTypeBreakdown {
    event_type: string
    count: number
}

export interface RecentEvent {
    id: string
    created_at: string
    event_type: string
    event_category: string
    event_source: string
    user_email: string | null
    tenant_id: string | null
    aws_account_id: string | null
    song_id: string | null
    song_title: string | null
    session_id: string | null
    properties: Record<string, unknown> | null
}

export interface AnalyticsDashboard {
    window_start: string
    window_end: string
    granularity: 'day' | 'week' | 'month'
    overview: AnalyticsOverview
    trends: EventTrend[]
    event_breakdown: EventTypeBreakdown[]
    top_songs: SongRanking[]
    user_activity: UserActivity[]
    recent_events: RecentEvent[]
}

export interface TrackingEvent {
    event_type: string
    event_category: string
    song_id?: string | null
    song_title?: string | null
    session_id?: string | null
    properties?: Record<string, unknown>
}

/** The device, browser and app build a batch of events was sent from. */
export interface ClientInfo {
    device: string
    os: string
    browser: string
    /** Launched from the home screen as an installed app. */
    standalone: boolean
    viewport: string
    /** Build stamp of the running bundle; an old one means a stale cached app. */
    app_version: string
}

export interface TrackEventsRequest {
    events: TrackingEvent[]
    client?: ClientInfo
}

export interface TrackEventsResponse {
    accepted: number
}

export interface AnalyticsAccessResponse {
    allowed: boolean
    email: string | null
}

export interface AnalyticsUserEmailsResponse {
    items: string[]
}

export interface AnalyticsQueryParams {
    since?: string
    until?: string
    days?: number
    granularity?: 'day' | 'week' | 'month'
    user_email?: string
    event_type?: string
    limit?: number
}

import { env } from '@/config/env'
import { useAuthStore } from '@/stores/auth.store'
import type { TrackingEvent } from '@/types/analytics'

const FLUSH_INTERVAL_MS = 5000
const MAX_BATCH_SIZE = 10
const SESSION_STORAGE_KEY = 'analytics-session-id'

function generateSessionId(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID()
    }
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

class EventTracker {
    private queue: TrackingEvent[] = []
    private flushTimer: number | null = null
    private isFlushing = false

    getSessionId(): string {
        if (typeof window === 'undefined') return 'server-session'
        const existing = window.sessionStorage.getItem(SESSION_STORAGE_KEY)
        if (existing) return existing
        const next = generateSessionId()
        window.sessionStorage.setItem(SESSION_STORAGE_KEY, next)
        return next
    }

    start() {
        if (this.flushTimer !== null || typeof window === 'undefined') return
        this.flushTimer = window.setInterval(() => {
            void this.flush()
        }, FLUSH_INTERVAL_MS)
    }

    stop() {
        if (this.flushTimer !== null && typeof window !== 'undefined') {
            window.clearInterval(this.flushTimer)
            this.flushTimer = null
        }
    }

    track(event: TrackingEvent) {
        const state = useAuthStore.getState()
        const token = state.idToken || state.accessToken
        if (!token) return

        this.queue.push({
            ...event,
            session_id: event.session_id ?? this.getSessionId(),
        })

        if (this.queue.length >= MAX_BATCH_SIZE) {
            void this.flush()
        }
    }

    async flush(options?: { keepalive?: boolean }) {
        const state = useAuthStore.getState()
        const token = state.idToken || state.accessToken
        if (!token || this.queue.length === 0 || this.isFlushing) {
            if (!token) this.queue = []
            return
        }

        this.isFlushing = true
        const events = [...this.queue]
        this.queue = []

        try {
            await fetch(`${env.apiBaseUrl}/api/v1/analytics/track/batch`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({ events }),
                keepalive: options?.keepalive ?? false,
            })
        } catch {
            this.queue.unshift(...events)
        } finally {
            this.isFlushing = false
        }
    }
}

export const analyticsTracker = new EventTracker()

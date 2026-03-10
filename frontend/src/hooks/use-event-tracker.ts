import { useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import { analyticsTracker } from '@/lib/event-tracker'
import { useAuthStore } from '@/stores/auth.store'
import { usePlaybackStore } from '@/stores/playback.store'

export function useEventTracker() {
    const location = useLocation()
    const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
    const lastPathRef = useRef<string>('')

    useEffect(() => {
        if (!isAuthenticated) {
            analyticsTracker.stop()
            return
        }

        analyticsTracker.start()
        analyticsTracker.track({
            event_type: 'session_start',
            event_category: 'session',
            properties: { path: location.pathname },
        })

        const handleVisibility = () => {
            if (document.visibilityState === 'hidden') {
                void analyticsTracker.flush({ keepalive: true })
            }
        }

        const handlePageHide = () => {
            void analyticsTracker.flush({ keepalive: true })
        }

        const unsubscribePlayback = usePlaybackStore.subscribe((state, prevState) => {
            if (state.currentStem !== prevState.currentStem && state.currentSongId) {
                analyticsTracker.track({
                    event_type: 'stem_switched',
                    event_category: 'player',
                    song_id: state.currentSongId,
                    properties: { stem: state.currentStem },
                })
            }
            if (state.playbackRate !== prevState.playbackRate && state.currentSongId) {
                analyticsTracker.track({
                    event_type: 'playback_rate_changed',
                    event_category: 'player',
                    song_id: state.currentSongId,
                    properties: { playback_rate: state.playbackRate },
                })
            }
            if (state.sheetMode !== prevState.sheetMode && state.currentSongId) {
                analyticsTracker.track({
                    event_type: 'sheet_mode_changed',
                    event_category: 'player',
                    song_id: state.currentSongId,
                    properties: { sheet_mode: state.sheetMode },
                })
            }
        })

        document.addEventListener('visibilitychange', handleVisibility)
        window.addEventListener('pagehide', handlePageHide)

        return () => {
            unsubscribePlayback()
            document.removeEventListener('visibilitychange', handleVisibility)
            window.removeEventListener('pagehide', handlePageHide)
            analyticsTracker.track({ event_type: 'session_end', event_category: 'session' })
            void analyticsTracker.flush({ keepalive: true })
            analyticsTracker.stop()
        }
    }, [isAuthenticated])

    useEffect(() => {
        if (!isAuthenticated) return
        const path = `${location.pathname}${location.search}`
        if (lastPathRef.current === path) return
        lastPathRef.current = path
        analyticsTracker.track({
            event_type: 'page_view',
            event_category: 'navigation',
            properties: { path, title: document.title || null },
        })
    }, [isAuthenticated, location.pathname, location.search])
}

import { useEffect, useRef } from 'react'
import { useQueries } from '@tanstack/react-query'
import { toast } from 'sonner'
import { jobsApi } from '@/api/jobs.api'
import { queryKeys } from '@/api/query-keys'
import { useJobWatcherStore } from '@/stores/job-watcher.store'
import { showBrowserNotification } from '@/lib/notify'
import { songDetailPath } from '@/router/routes'
import { router } from '@/router'

/**
 * Headless component that polls watched jobs and fires in-app toasts
 * and browser notifications when jobs complete while the user is away.
 */
export function JobWatcher() {
  const watchedJobs = useJobWatcherStore((s) => s.watchedJobs)
  const viewingSongIds = useJobWatcherStore((s) => s.viewingSongIds)
  const unwatchJob = useJobWatcherStore((s) => s.unwatchJob)

  const jobEntries = Array.from(watchedJobs.values())

  // Track which jobs we've already notified about to prevent double-firing.
  const notifiedRef = useRef(new Set<string>())

  const queries = useQueries({
    queries: jobEntries.map((entry) => ({
      queryKey: queryKeys.jobs.detail(entry.jobId),
      queryFn: () => jobsApi.get(entry.jobId),
      refetchInterval: 10_000,
      enabled: true,
    })),
  })

  useEffect(() => {
    queries.forEach((query, i) => {
      const entry = jobEntries[i]
      if (!entry || !query.data) return

      const { status } = query.data
      if (status !== 'COMPLETED' && status !== 'FAILED') return
      if (notifiedRef.current.has(entry.jobId)) return

      notifiedRef.current.add(entry.jobId)

      const isViewing = viewingSongIds.has(entry.songId)
      const label = entry.songArtist
        ? `${entry.songTitle} - ${entry.songArtist}`
        : entry.songTitle

      if (!isViewing) {
        // In-app toast
        if (status === 'COMPLETED') {
          toast.success(`"${label}" is ready!`, {
            description: 'Tap to open',
            duration: 10_000,
            action: {
              label: 'Open',
              onClick: () => router.navigate(songDetailPath(entry.songId)),
            },
          })
        } else {
          toast.error(`Processing failed for "${label}"`, {
            description: query.data.error_message || 'Please try again',
            duration: 10_000,
            action: {
              label: 'View',
              onClick: () => router.navigate(songDetailPath(entry.songId)),
            },
          })
        }
      }

      // Browser notification (when tab is not focused, regardless of in-app page)
      if (document.hidden) {
        showBrowserNotification({
          title: status === 'COMPLETED' ? 'Song is ready!' : 'Processing failed',
          body: label,
          songId: entry.songId,
          tag: `job-${entry.jobId}`,
        })
      }

      unwatchJob(entry.jobId)
    })
  }, [queries, jobEntries, viewingSongIds, unwatchJob])

  return null
}

import { create } from 'zustand'

export interface WatchedJob {
  jobId: string
  songId: string
  songTitle: string
  songArtist: string
}

interface JobWatcherState {
  /** Jobs started this session that are still processing. */
  watchedJobs: Map<string, WatchedJob>
  /** Song IDs the user is currently viewing (on SongDetailPage). */
  viewingSongIds: Set<string>

  watchJob: (job: WatchedJob) => void
  unwatchJob: (jobId: string) => void
  addViewingSong: (songId: string) => void
  removeViewingSong: (songId: string) => void
}

export const useJobWatcherStore = create<JobWatcherState>()((set) => ({
  watchedJobs: new Map(),
  viewingSongIds: new Set(),

  watchJob: (job) =>
    set((state) => {
      const next = new Map(state.watchedJobs)
      next.set(job.jobId, job)
      return { watchedJobs: next }
    }),

  unwatchJob: (jobId) =>
    set((state) => {
      const next = new Map(state.watchedJobs)
      next.delete(jobId)
      return { watchedJobs: next }
    }),

  addViewingSong: (songId) =>
    set((state) => {
      const next = new Set(state.viewingSongIds)
      next.add(songId)
      return { viewingSongIds: next }
    }),

  removeViewingSong: (songId) =>
    set((state) => {
      const next = new Set(state.viewingSongIds)
      next.delete(songId)
      return { viewingSongIds: next }
    }),
}))

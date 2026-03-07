import { create } from 'zustand'

interface SongMediaCacheState {
  thumbnailBySongId: Record<string, string>
  thumbnailFailedBySongId: Record<string, boolean>

  setThumbnailIfMissing: (songId: string, url: string) => void
  markThumbnailFailed: (songId: string) => void
  clearSong: (songId: string) => void
}

/**
 * A tiny client-side cache for media URLs that should remain stable during a
 * polling session.
 *
 * In prod, thumbnails are often presigned URLs that rotate on each poll cycle.
 * If we use the new URL each time, the browser re-fetches the image repeatedly
 * causing visible flicker.
 */
export const useSongMediaCacheStore = create<SongMediaCacheState>()((set) => ({
  thumbnailBySongId: {},
  thumbnailFailedBySongId: {},

  setThumbnailIfMissing: (songId, url) =>
    set((state) => {
      if (!songId || !url) return state
      if (state.thumbnailBySongId[songId]) return state
      return {
        ...state,
        thumbnailBySongId: { ...state.thumbnailBySongId, [songId]: url },
      }
    }),

  markThumbnailFailed: (songId) =>
    set((state) => ({
      ...state,
      thumbnailFailedBySongId: { ...state.thumbnailFailedBySongId, [songId]: true },
    })),

  clearSong: (songId) =>
    set((state) => {
      if (!songId) return state

      const restThumbs = { ...state.thumbnailBySongId }
      delete restThumbs[songId]

      const restFailed = { ...state.thumbnailFailedBySongId }
      delete restFailed[songId]

      return {
        ...state,
        thumbnailBySongId: restThumbs,
        thumbnailFailedBySongId: restFailed,
      }
    }),
}))

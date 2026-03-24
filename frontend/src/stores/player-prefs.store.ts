import { create } from 'zustand'
import { persist } from 'zustand/middleware'

function clampInt(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min
  const rounded = Math.trunc(n)
  return Math.max(min, Math.min(max, rounded))
}

export type LyricsMode = 'ver1' | 'ver2' | 'ver3' | 'ver4' | 'none'
export type StrumSource = 'songsterr' | 'ai'

export interface PlayerPrefsState {
  /** Display-only transpose in semitones. */
  transposeSemitones: number
  /** Show/hide strumming arrows in the chord sheet. */
  showStrums: boolean
  /** Lyrics sync offset in milliseconds. Positive = lyrics delayed (for when
   *  highlights appear too early). Negative = lyrics advanced. */
  lyricsOffsetMs: number
  /** Auto-scroll speed in pixels per second (used when lyricsMode is 'none'). */
  autoScrollSpeed: number
  /** Lyrics display mode:
    *  - 'ver1': show the quick/base lyrics version with highlighting
    *  - 'ver2': show the regular/timed lyrics version with highlighting
    *  - 'ver3': show the merged/fixed lyrics version with highlighting
   *  - 'none': disable highlighting, use auto-scroll */
  lyricsMode: LyricsMode
  /** Strum pattern source: 'songsterr' (tab data) or 'ai' (LLM-generated). */
  strumSource: StrumSource
  /** Automatically start recording when a song starts playing. */
  autoRecord: boolean
  /** Automatically download recordings when recording stops.
   *  When false, a download button is shown instead. */
  autoDownloadRecordings: boolean
  setTransposeSemitones: (semitones: number) => void
  transposeUp: () => void
  transposeDown: () => void
  resetTranspose: () => void
  setShowStrums: (show: boolean) => void
  toggleShowStrums: () => void
  setLyricsOffsetMs: (ms: number) => void
  setAutoScrollSpeed: (pxPerSec: number) => void
  setLyricsMode: (mode: LyricsMode) => void
  setStrumSource: (source: StrumSource) => void
  cycleStrumSource: () => void
  setAutoRecord: (enabled: boolean) => void
  setAutoDownloadRecordings: (enabled: boolean) => void
}

export const usePlayerPrefsStore = create<PlayerPrefsState>()(
  persist(
    (set, get) => ({
      transposeSemitones: 0,
      showStrums: true,
      lyricsOffsetMs: 0,
      autoScrollSpeed: 60,
      lyricsMode: 'ver1' as LyricsMode,
      strumSource: 'songsterr' as StrumSource,
      autoRecord: false,
      autoDownloadRecordings: true,
      setTransposeSemitones: (semitones) =>
        set({ transposeSemitones: clampInt(semitones, -12, 12) }),
      transposeUp: () => {
        const next = clampInt(get().transposeSemitones + 1, -12, 12)
        set({ transposeSemitones: next })
      },
      transposeDown: () => {
        const next = clampInt(get().transposeSemitones - 1, -12, 12)
        set({ transposeSemitones: next })
      },
      resetTranspose: () => set({ transposeSemitones: 0 }),
      setShowStrums: (show) => set({ showStrums: !!show }),
      toggleShowStrums: () => set({ showStrums: !get().showStrums }),
      setLyricsOffsetMs: (ms) =>
        set({ lyricsOffsetMs: clampInt(ms, -2000, 2000) }),
      setAutoScrollSpeed: (pxPerSec) =>
        set({ autoScrollSpeed: clampInt(pxPerSec, 10, 200) }),
      setLyricsMode: (mode) => set({ lyricsMode: mode }),
      setStrumSource: (source) => set({ strumSource: source }),
      cycleStrumSource: () =>
        set({ strumSource: get().strumSource === 'songsterr' ? 'ai' : 'songsterr' }),
      setAutoRecord: (enabled) => set({ autoRecord: !!enabled }),
      setAutoDownloadRecordings: (enabled) => set({ autoDownloadRecordings: !!enabled }),
    }),
    {
      name: 'player-prefs',
      migrate: (persisted: unknown) => {
        const state = persisted as Record<string, unknown>
        if (state) {
          const currentMode = state.lyricsMode as string | undefined
          if (currentMode === 'quick') {
            state.lyricsMode = 'ver1'
          } else if (currentMode === 'accurate' || currentMode === 'precise') {
            state.lyricsMode = 'ver2'
          }
        }

        if (state && !state.lyricsMode) {
          const hadHighlight = state.showHighlight !== false
          const oldVersion = state.lyricsVersion as string | undefined
          if (!hadHighlight) {
            state.lyricsMode = 'none'
          } else if (oldVersion === 'precise') {
            state.lyricsMode = 'ver2'
          } else {
            state.lyricsMode = 'ver1'
          }
          delete state.showHighlight
          delete state.lyricsVersion
        }

        // Default strumSource if not present
        if (state && !state.strumSource) {
          state.strumSource = 'songsterr'
        }

        // Default recording settings if not present (v3 → v4)
        if (state && state.autoRecord === undefined) {
          state.autoRecord = false
        }
        if (state && state.autoDownloadRecordings === undefined) {
          state.autoDownloadRecordings = true
        }

        return state as unknown as PlayerPrefsState
      },
      version: 4,
    }
  )
)

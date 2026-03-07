import { create } from 'zustand'
import { persist } from 'zustand/middleware'

function clampInt(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min
  const rounded = Math.trunc(n)
  return Math.max(min, Math.min(max, rounded))
}

export type LyricsMode = 'quick' | 'accurate' | 'none'

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
   *  - 'quick': show fast-aligned LRCLIB lyrics with highlighting
   *  - 'accurate': show Whisper-transcribed lyrics with highlighting
   *  - 'none': disable highlighting, use auto-scroll */
  lyricsMode: LyricsMode
  setTransposeSemitones: (semitones: number) => void
  transposeUp: () => void
  transposeDown: () => void
  resetTranspose: () => void
  setShowStrums: (show: boolean) => void
  toggleShowStrums: () => void
  setLyricsOffsetMs: (ms: number) => void
  setAutoScrollSpeed: (pxPerSec: number) => void
  setLyricsMode: (mode: LyricsMode) => void
}

export const usePlayerPrefsStore = create<PlayerPrefsState>()(
  persist(
    (set, get) => ({
      transposeSemitones: 0,
      showStrums: true,
      lyricsOffsetMs: 0,
      autoScrollSpeed: 60,
      lyricsMode: 'quick' as LyricsMode,
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
    }),
    {
      name: 'player-prefs',
      // Migrate old persisted state that had showHighlight + lyricsVersion
      migrate: (persisted: unknown) => {
        const state = persisted as Record<string, unknown>
        if (state && !state.lyricsMode) {
          const hadHighlight = state.showHighlight !== false
          const oldVersion = state.lyricsVersion as string | undefined
          if (!hadHighlight) {
            state.lyricsMode = 'none'
          } else if (oldVersion === 'precise') {
            state.lyricsMode = 'accurate'
          } else {
            state.lyricsMode = 'quick'
          }
          delete state.showHighlight
          delete state.lyricsVersion
        }
        return state as unknown as PlayerPrefsState
      },
      version: 1,
    }
  )
)

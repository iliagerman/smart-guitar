import { create } from 'zustand'

export type StemName = string
export type SheetMode = 'chords' | 'tabs'

interface PlaybackState {
  currentSongId: string | null
  /** Active individual stems (e.g. ['vocals', 'drums']). Empty when isFullSong is true. */
  activeStems: string[]
  /** When true, the original full MP3 plays. Mutually exclusive with individual stems. */
  isFullSong: boolean
  isPlaying: boolean
  currentTime: number
  duration: number
  playbackRate: number
  sheetMode: SheetMode
  selectedChordOptionIndex: number | null
  setCurrentSong: (songId: string) => void
  /** Toggle a stem on/off. Switches out of full-song mode when enabling a stem. */
  toggleStem: (stem: string) => void
  /** Bulk-set active stems (e.g. from default preferences). Switches out of full-song mode. */
  setActiveStems: (stems: string[]) => void
  /** Switch to full-song mode (original MP3). Clears individual stems. */
  selectFullSong: () => void
  setPlaying: (playing: boolean) => void
  setCurrentTime: (time: number) => void
  setDuration: (duration: number) => void
  setPlaybackRate: (rate: number) => void
  setSheetMode: (mode: SheetMode) => void
  setSelectedChordOptionIndex: (index: number | null) => void
  reset: () => void
}

export const usePlaybackStore = create<PlaybackState>()((set, get) => ({
  currentSongId: null,
  activeStems: [],
  isFullSong: true,
  isPlaying: false,
  currentTime: 0,
  duration: 0,
  playbackRate: 1,
  sheetMode: 'chords',
  selectedChordOptionIndex: null,
  setCurrentSong: (songId) =>
    set({ currentSongId: songId, currentTime: 0, isPlaying: false, sheetMode: 'chords', selectedChordOptionIndex: null }),
  toggleStem: (stem) => {
    const { activeStems, isFullSong } = get()
    if (isFullSong) {
      // Switching from full-song mode: start with just this stem
      set({ isFullSong: false, activeStems: [stem] })
      return
    }
    const idx = activeStems.indexOf(stem)
    if (idx >= 0) {
      const next = activeStems.filter((s) => s !== stem)
      if (next.length === 0) {
        // No stems left — switch back to full song
        set({ isFullSong: true, activeStems: [] })
      } else {
        set({ activeStems: next })
      }
    } else {
      set({ activeStems: [...activeStems, stem] })
    }
  },
  setActiveStems: (stems) => {
    if (stems.length === 0) {
      set({ isFullSong: true, activeStems: [] })
    } else {
      set({ isFullSong: false, activeStems: stems })
    }
  },
  selectFullSong: () => set({ isFullSong: true, activeStems: [] }),
  setPlaying: (playing) => set({ isPlaying: playing }),
  setCurrentTime: (time) => set({ currentTime: time }),
  setDuration: (duration) => set({ duration }),
  setPlaybackRate: (rate) =>
    set({ playbackRate: Number.isFinite(rate) && rate > 0 ? rate : 1 }),
  setSheetMode: (mode) => set({ sheetMode: mode }),
  setSelectedChordOptionIndex: (index) => set({ selectedChordOptionIndex: index }),
  reset: () =>
    set({
      currentSongId: null,
      activeStems: [],
      isFullSong: true,
      isPlaying: false,
      currentTime: 0,
      duration: 0,
      playbackRate: 1,
      sheetMode: 'chords',
      selectedChordOptionIndex: null,
    }),
}))

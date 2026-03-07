import { create } from 'zustand'

export type StemName = string
export type SheetMode = 'chords' | 'tabs'

interface PlaybackState {
  currentSongId: string | null
  currentStem: StemName
  isPlaying: boolean
  currentTime: number
  duration: number
  playbackRate: number
  sheetMode: SheetMode
  selectedChordOptionIndex: number | null
  setCurrentSong: (songId: string) => void
  setStem: (stem: StemName) => void
  setPlaying: (playing: boolean) => void
  setCurrentTime: (time: number) => void
  setDuration: (duration: number) => void
  setPlaybackRate: (rate: number) => void
  setSheetMode: (mode: SheetMode) => void
  setSelectedChordOptionIndex: (index: number | null) => void
  reset: () => void
}

export const usePlaybackStore = create<PlaybackState>()((set) => ({
  currentSongId: null,
  currentStem: 'full_mix',
  isPlaying: false,
  currentTime: 0,
  duration: 0,
  playbackRate: 1,
  sheetMode: 'chords',
  selectedChordOptionIndex: null,
  setCurrentSong: (songId) =>
    set({ currentSongId: songId, currentTime: 0, sheetMode: 'chords', selectedChordOptionIndex: null }),
  setStem: (stem) => set({ currentStem: stem }),
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
      currentStem: 'full_mix',
      isPlaying: false,
      currentTime: 0,
      duration: 0,
      playbackRate: 1,
      sheetMode: 'chords',
      selectedChordOptionIndex: null,
    }),
}))

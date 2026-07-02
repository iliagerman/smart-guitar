import { create } from 'zustand'

/** Minimum A/B loop length — a shorter loop would just freeze playback at A. */
const MIN_LOOP_SECONDS = 0.5

export type SheetMode = 'chords' | 'tabs' | 'bars'
export type ChordDisplayMode = 'standard' | 'beginner' | 'capo'

interface PlaybackState {
  currentSongId: string | null
  /** Active individual stems (e.g. ['vocals', 'drums']). Empty when isFullSong is true. */
  activeStems: string[]
  /** When true, the original full MP3 plays. Mutually exclusive with individual stems. */
  isFullSong: boolean
  isPlaying: boolean
  /** True once playback has started at least once for the current song. */
  hasPlaybackOccurred: boolean
  currentTime: number
  duration: number
  playbackRate: number
  sheetMode: SheetMode
  selectedChordOptionIndex: number | null
  chordDisplayMode: ChordDisplayMode
  chordCapoFret: number
  /** A/B loop start (seconds). Null when no loop point is set for this session. */
  loopStart: number | null
  /** A/B loop end (seconds). Null until a second marker is tapped. */
  loopEnd: number | null
  setCurrentSong: (songId: string) => void
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
  setChordDisplayMode: (mode: ChordDisplayMode, capoFret?: number) => void
  /**
   * Cycles the A/B loop marker: 1st tap sets the loop start, 2nd tap sets the
   * loop end (swapping if it lands before the start), 3rd tap clears the loop.
   */
  tapLoopMarker: (time: number) => void
  clearLoop: () => void
  reset: () => void
}

export const usePlaybackStore = create<PlaybackState>()((set, get) => ({
  currentSongId: null,
  activeStems: [],
  isFullSong: true,
  isPlaying: false,
  hasPlaybackOccurred: false,
  currentTime: 0,
  duration: 0,
  playbackRate: 1,
  sheetMode: 'chords',
  selectedChordOptionIndex: null,
  chordDisplayMode: 'standard',
  chordCapoFret: 0,
  loopStart: null,
  loopEnd: null,
  setCurrentSong: (songId) =>
    set({ currentSongId: songId, currentTime: 0, isPlaying: false, hasPlaybackOccurred: false, sheetMode: 'chords', selectedChordOptionIndex: null, chordDisplayMode: 'standard', chordCapoFret: 0, loopStart: null, loopEnd: null }),
  setActiveStems: (stems) => {
    if (stems.length === 0) {
      set({ isFullSong: true, activeStems: [] })
    } else {
      set({ isFullSong: false, activeStems: stems })
    }
  },
  selectFullSong: () => set({ isFullSong: true, activeStems: [] }),
  setPlaying: (playing) => set({ isPlaying: playing, hasPlaybackOccurred: playing ? true : get().hasPlaybackOccurred }),
  setCurrentTime: (time) => set({ currentTime: time }),
  setDuration: (duration) => set({ duration }),
  setPlaybackRate: (rate) =>
    set({ playbackRate: Number.isFinite(rate) && rate > 0 ? rate : 1 }),
  setSheetMode: (mode) => set({ sheetMode: mode }),
  setSelectedChordOptionIndex: (index) => set({ selectedChordOptionIndex: index }),
  setChordDisplayMode: (mode, capoFret) => set({ chordDisplayMode: mode, chordCapoFret: capoFret ?? 0 }),
  tapLoopMarker: (time) => {
    const { loopStart, loopEnd } = get()
    if (loopStart === null) {
      set({ loopStart: time, loopEnd: null })
    } else if (loopEnd === null) {
      if (Math.abs(time - loopStart) < MIN_LOOP_SECONDS) {
        return
      }
      if (time < loopStart) {
        set({ loopStart: time, loopEnd: loopStart })
      } else {
        set({ loopEnd: time })
      }
    } else {
      set({ loopStart: null, loopEnd: null })
    }
  },
  clearLoop: () => set({ loopStart: null, loopEnd: null }),
  reset: () =>
    set({
      currentSongId: null,
      activeStems: [],
      isFullSong: true,
      isPlaying: false,
      hasPlaybackOccurred: false,
      currentTime: 0,
      duration: 0,
      playbackRate: 1,
      sheetMode: 'chords',
      selectedChordOptionIndex: null,
      chordDisplayMode: 'standard',
      chordCapoFret: 0,
      loopStart: null,
      loopEnd: null,
    }),
}))

import { create } from 'zustand'

/** What the song page is showing right now; not saved between visits. */
interface SongViewState {
  /** The metronome strip above the chord sheet. */
  metronomeOpen: boolean
  /** Playing on a phone or tablet: the sheet takes the screen and the app nav steps aside. */
  immersive: boolean
  setMetronomeOpen: (open: boolean) => void
  toggleMetronome: () => void
  setImmersive: (immersive: boolean) => void
}

export const useSongViewStore = create<SongViewState>()((set, get) => ({
  metronomeOpen: false,
  immersive: false,
  setMetronomeOpen: (open) => set({ metronomeOpen: open }),
  toggleMetronome: () => set({ metronomeOpen: !get().metronomeOpen }),
  setImmersive: (immersive) => set({ immersive }),
}))

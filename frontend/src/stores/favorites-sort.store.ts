import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type FavoritesSortMode = 'recent' | 'most_played'

interface FavoritesSortState {
  sortMode: FavoritesSortMode
  setSortMode: (mode: FavoritesSortMode) => void
}

export const useFavoritesSortStore = create<FavoritesSortState>()(
  persist(
    (set) => ({
      sortMode: 'recent',
      setSortMode: (mode) => set({ sortMode: mode }),
    }),
    { name: 'favorites-sort' },
  ),
)

import { create } from 'zustand'

/** What the user tried to do when the paywall opened; picks the pitch shown. */
export type PaywallReason = 'stage' | 'band_member' | 'add_song' | 'record' | 'edit' | 'upgrade'

/** Song context shown in the paywall's progress recap. */
export interface PaywallSongContext {
  title: string
  learnedChords: number
  completedSteps: number
}

interface PaywallState {
  reason: PaywallReason | null
  song: PaywallSongContext | null
  openPaywall: (reason: PaywallReason, song?: PaywallSongContext) => void
  closePaywall: () => void
}

export const usePaywallStore = create<PaywallState>()((set) => ({
  reason: null,
  song: null,
  openPaywall: (reason, song) => set({ reason, song: song ?? null }),
  closePaywall: () => set({ reason: null, song: null }),
}))

import { create } from 'zustand'

interface TrialBannerState {
  dismissed: boolean
  dismiss: () => void
}

export const useTrialBannerStore = create<TrialBannerState>()((set) => ({
  dismissed: false,
  dismiss: () => set({ dismissed: true }),
}))

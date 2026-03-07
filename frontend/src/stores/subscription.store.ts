import { create } from 'zustand'
import type { SubscriptionStatus } from '@/types/subscription'

interface SubscriptionState {
  status: SubscriptionStatus | null
  isLoaded: boolean
  setStatus: (status: SubscriptionStatus) => void
  clear: () => void
}

export const useSubscriptionStore = create<SubscriptionState>()((set) => ({
  status: null,
  isLoaded: false,
  setStatus: (status) => set({ status, isLoaded: true }),
  clear: () => set({ status: null, isLoaded: false }),
}))

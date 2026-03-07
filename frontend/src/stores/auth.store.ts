import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface AuthState {
  accessToken: string | null
  idToken: string | null
  refreshToken: string | null
  email: string | null
  isAuthenticated: boolean
  setTokens: (access: string, id: string, refresh: string) => void
  setEmail: (email: string) => void
  logout: () => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      accessToken: null,
      idToken: null,
      refreshToken: null,
      email: null,
      isAuthenticated: false,
      setTokens: (access, id, refresh) =>
        set({ accessToken: access, idToken: id, refreshToken: refresh, isAuthenticated: true }),
      setEmail: (email) => set({ email }),
      logout: () =>
        set({ accessToken: null, idToken: null, refreshToken: null, email: null, isAuthenticated: false }),
    }),
    { name: 'auth-storage' }
  )
)

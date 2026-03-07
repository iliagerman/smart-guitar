import axios from 'axios'
import type { AxiosError } from 'axios'
import { fetchAuthSession } from 'aws-amplify/auth'
import { env } from './env'
import { useAuthStore } from '../stores/auth.store'
import { useSubscriptionStore } from '../stores/subscription.store'

export const api = axios.create({
  baseURL: env.apiBaseUrl,
  headers: { 'Content-Type': 'application/json' },
})

api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().accessToken
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

type ErrorDetailResponse = {
  detail?: unknown
}

function isTokenExpiredError(error: unknown): boolean {
  const err = error as AxiosError<ErrorDetailResponse>
  const status = err.response?.status
  if (status === 401) return true
  if (status === 403) {
    const detail = err.response?.data?.detail
    if (typeof detail === 'string' && detail.toLowerCase().includes('expired')) return true
    if (detail === 'Invalid or expired token') return true
  }
  return false
}

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    // Handle subscription required
    if (
      error.response?.status === 403 &&
      error.response?.data?.detail?.error_code === 'SUBSCRIPTION_REQUIRED'
    ) {
      useSubscriptionStore.getState().setStatus({
        has_access: false,
        trial_ends_at: null,
        trial_active: false,
        subscription: null,
      })
      return Promise.reject(error)
    }

    const original = error.config
    if (isTokenExpiredError(error) && !original._retry) {
      original._retry = true
      try {
        const refreshToken = useAuthStore.getState().refreshToken
        if (refreshToken) {
          // Email/password login: refresh via backend
          const { data } = await axios.post(`${env.apiBaseUrl}/auth/refresh`, {
            refresh_token: refreshToken,
          })
          useAuthStore.getState().setTokens(data.access_token, data.id_token, refreshToken)
          original.headers.Authorization = `Bearer ${data.access_token}`
          return api(original)
        }

        // Google OAuth: refresh via Amplify (Cognito handles refresh internally)
        const session = await fetchAuthSession({ forceRefresh: true })
        const accessToken = session.tokens?.accessToken?.toString()
        const idToken = session.tokens?.idToken?.toString()
        if (accessToken && idToken) {
          useAuthStore.getState().setTokens(accessToken, idToken, '')
          original.headers.Authorization = `Bearer ${accessToken}`
          return api(original)
        }
      } catch {
        useAuthStore.getState().logout()
      }
    }
    return Promise.reject(error)
  }
)

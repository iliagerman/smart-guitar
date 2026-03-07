import { api } from '../config/api'
import type { LoginRequest, RegisterRequest, ConfirmRequest, AuthTokens } from '../types/auth'

export const authApi = {
  login: (data: LoginRequest) =>
    api.post<AuthTokens>('/auth/login', data).then((r) => r.data),

  register: (data: RegisterRequest) =>
    api.post<{ message: string }>('/auth/register', data).then((r) => r.data),

  confirm: (data: ConfirmRequest) =>
    api.post<{ message: string }>('/auth/confirm', data).then((r) => r.data),

  resendCode: (email: string) =>
    api.post<{ message: string }>('/auth/resend-code', { email }).then((r) => r.data),

  refresh: (refreshToken: string) =>
    api.post<AuthTokens>('/auth/refresh', { refresh_token: refreshToken }).then((r) => r.data),
}

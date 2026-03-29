import { api } from '../config/api'
import type { MessageResponse } from '../types/api'
import type { LoginRequest, RegisterRequest, ConfirmRequest, AuthTokens } from '../types/auth'

export const authApi = {
  login: (data: LoginRequest) =>
    api.post<AuthTokens>('/auth/login', data).then((r) => r.data),

  register: (data: RegisterRequest) =>
    api.post<MessageResponse>('/auth/register', data).then((r) => r.data),

  confirm: (data: ConfirmRequest) =>
    api.post<MessageResponse>('/auth/confirm', data).then((r) => r.data),

  resendCode: (email: string) =>
    api.post<MessageResponse>('/auth/resend-code', { email }).then((r) => r.data),

  refresh: (refreshToken: string) =>
    api.post<AuthTokens>('/auth/refresh', { refresh_token: refreshToken }).then((r) => r.data),
}

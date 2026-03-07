export interface LoginRequest {
  email: string
  password: string
}

export interface RegisterRequest {
  email: string
  password: string
}

export interface ConfirmRequest {
  email: string
  confirmation_code: string
}

export interface AuthTokens {
  access_token: string
  id_token: string
  refresh_token: string
}

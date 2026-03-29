export interface PaginatedResponse<T> {
  items: T[]
  total: number
  offset: number
  limit: number
}

export interface MessageResponse {
  message: string
}

export interface ErrorResponse {
  detail: string
}

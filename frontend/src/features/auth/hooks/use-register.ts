import { useMutation } from '@tanstack/react-query'
import { authApi } from '@/api/auth.api'
import type { RegisterRequest } from '@/types/auth'

export function useRegister() {
  return useMutation({
    mutationFn: (data: RegisterRequest) => authApi.register(data),
  })
}

import { useMutation } from '@tanstack/react-query'
import { authApi } from '@/api/auth.api'
import type { RegisterRequest } from '@/types/auth'

export function useRegister() {
  // Creates an account, then the UI navigates to email confirmation. No client-side
  // cached query reflects account creation, so there is nothing to invalidate.
  // oxlint-disable-next-line react-doctor/query-mutation-missing-invalidation
  return useMutation({
    mutationFn: (data: RegisterRequest) => authApi.register(data),
  })
}

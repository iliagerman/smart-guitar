import { useMutation } from '@tanstack/react-query'
import { authApi } from '@/api/auth.api'
import { useAuthStore } from '@/stores/auth.store'
import type { LoginRequest } from '@/types/auth'

export function useLogin() {
  const setTokens = useAuthStore((s) => s.setTokens)
  const setEmail = useAuthStore((s) => s.setEmail)

  return useMutation({
    mutationFn: (data: LoginRequest) => authApi.login(data),
    onSuccess: (tokens, variables) => {
      setTokens(tokens.access_token, tokens.id_token, tokens.refresh_token)
      setEmail(variables.email)
    },
  })
}

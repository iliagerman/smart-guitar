import { useMutation } from '@tanstack/react-query'
import { authApi } from '@/api/auth.api'
import type { ConfirmRequest } from '@/types/auth'

export function useConfirm() {
  return useMutation({
    mutationFn: (data: ConfirmRequest) => authApi.confirm(data),
  })
}

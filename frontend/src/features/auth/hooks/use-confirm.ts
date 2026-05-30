import { useMutation } from '@tanstack/react-query'
import { authApi } from '@/api/auth.api'
import type { ConfirmRequest } from '@/types/auth'

export function useConfirm() {
  // Confirms the account, then the UI navigates to sign-in. No client-side cached
  // query reflects confirmation, so there is nothing to invalidate.
  // oxlint-disable-next-line react-doctor/query-mutation-missing-invalidation
  return useMutation({
    mutationFn: (data: ConfirmRequest) => authApi.confirm(data),
  })
}

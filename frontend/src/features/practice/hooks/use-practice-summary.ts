import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { practiceApi } from '@/api/practice.api'
import { queryKeys } from '@/api/query-keys'
import type { SkillLevel } from '@/types/practice'

/** Home-screen practice summary: level, streak and songs to continue. */
export function usePracticeSummary() {
  return useQuery({
    queryKey: queryKeys.practice.summary(),
    queryFn: practiceApi.summary,
    staleTime: 30_000,
  })
}

/** Saves the user's skill level, which reorders the setlists. */
export function useSetSkillLevel() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (level: SkillLevel) => practiceApi.setLevel(level),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.practice.summary() })
      void queryClient.invalidateQueries({ queryKey: ['songs', 'setlists'] })
    },
  })
}

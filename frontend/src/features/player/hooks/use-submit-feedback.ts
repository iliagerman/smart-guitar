import { useMutation } from '@tanstack/react-query'
import { songsApi } from '@/api/songs.api'

interface FeedbackParams {
  songId: string
  rating: 'thumbs_up' | 'thumbs_down'
  comment?: string
}

export function useSubmitFeedback() {
  // Feedback is fire-and-forget (the API returns only a message and no cached query
  // carries the user's rating), so there is nothing to invalidate.
  // oxlint-disable-next-line react-doctor/query-mutation-missing-invalidation
  return useMutation({
    mutationFn: ({ songId, rating, comment }: FeedbackParams) =>
      songsApi.submitFeedback(songId, rating, comment),
  })
}

import { useMutation } from '@tanstack/react-query'
import { songsApi } from '@/api/songs.api'

interface FeedbackParams {
  songId: string
  rating: 'thumbs_up' | 'thumbs_down'
  comment?: string
}

export function useSubmitFeedback() {
  return useMutation({
    mutationFn: ({ songId, rating, comment }: FeedbackParams) =>
      songsApi.submitFeedback(songId, rating, comment),
  })
}

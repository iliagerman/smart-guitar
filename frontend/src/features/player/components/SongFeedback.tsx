import { useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { ThumbsUp, ThumbsDown, X } from 'lucide-react'
import { cn } from '@/lib/cn'
import { useSubmitFeedback } from '../hooks/use-submit-feedback'

interface SongFeedbackProps {
  songId: string
}

export function SongFeedback({ songId }: SongFeedbackProps) {
  const [open, setOpen] = useState(false)
  const [selectedRating, setSelectedRating] = useState<'thumbs_up' | 'thumbs_down' | null>(null)
  const [comment, setComment] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const feedback = useSubmitFeedback()

  const handleThumbClick = (rating: 'thumbs_up' | 'thumbs_down') => {
    setSelectedRating(rating)
    setComment('')
    setSubmitted(false)
    feedback.reset()
    setOpen(true)
  }

  const handleSubmit = () => {
    if (!selectedRating) return
    feedback.mutate(
      { songId, rating: selectedRating, comment: comment.trim() || undefined },
      {
        onSuccess: () => {
          setSubmitted(true)
          setTimeout(() => setOpen(false), 1200)
        },
      },
    )
  }

  return (
    <>
      <div className="flex items-center gap-1 shrink-0">
        <button
          type="button"
          onClick={() => handleThumbClick('thumbs_up')}
          className="p-1 rounded-full text-smoke-400 hover:text-green-400 transition-colors"
          aria-label="Thumbs up"
        >
          <ThumbsUp size={14} />
        </button>
        <button
          type="button"
          onClick={() => handleThumbClick('thumbs_down')}
          className="p-1 rounded-full text-smoke-400 hover:text-red-400 transition-colors"
          aria-label="Thumbs down"
        >
          <ThumbsDown size={14} />
        </button>
      </div>

      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50" />
          <Dialog.Content
            className={cn(
              'fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50',
              'w-[calc(100%-2rem)] max-w-sm',
              'rounded-2xl bg-charcoal-900 border border-charcoal-700 shadow-2xl p-4',
            )}
          >
            <div className="flex items-center justify-between mb-3">
              <Dialog.Title className="text-sm font-semibold text-smoke-100">
                {selectedRating === 'thumbs_up' ? '\uD83D\uDC4D' : '\uD83D\uDC4E'} Send Feedback
              </Dialog.Title>
              <Dialog.Close className="text-smoke-500 hover:text-smoke-200 transition-colors">
                <X size={18} />
              </Dialog.Close>
            </div>

            {submitted ? (
              <p className="text-sm text-green-400 py-4 text-center">Thanks for your feedback!</p>
            ) : (
              <>
                <textarea
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder="Add a comment (optional)..."
                  rows={3}
                  maxLength={500}
                  className={cn(
                    'w-full rounded-lg bg-charcoal-800 border border-charcoal-600 px-3 py-2',
                    'text-sm text-smoke-100 placeholder:text-smoke-500',
                    'focus:outline-none focus:ring-2 focus:ring-flame-400/40 focus:border-flame-400/30',
                    'resize-none',
                  )}
                />
                <div className="flex justify-end gap-2 mt-3">
                  <Dialog.Close className="px-3 py-1.5 rounded-lg text-sm text-smoke-400 hover:text-smoke-200 transition-colors">
                    Cancel
                  </Dialog.Close>
                  <button
                    type="button"
                    onClick={handleSubmit}
                    disabled={feedback.isPending}
                    className={cn(
                      'px-4 py-1.5 rounded-lg text-sm font-medium transition-colors',
                      'bg-flame-400 text-charcoal-950 hover:bg-flame-500',
                      'disabled:opacity-50 disabled:pointer-events-none',
                    )}
                  >
                    {feedback.isPending ? 'Sending...' : 'Send'}
                  </button>
                </div>
                {feedback.isError && (
                  <p className="text-xs text-red-400 mt-2 text-center">Failed to send. Please try again.</p>
                )}
              </>
            )}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  )
}

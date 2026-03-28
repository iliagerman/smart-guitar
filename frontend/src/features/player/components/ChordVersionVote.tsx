import { ThumbsUp, ThumbsDown } from 'lucide-react'
import { useChordVote } from '../hooks/use-chord-vote'
import { cn } from '@/lib/cn'

interface ChordVersionVoteProps {
  songId: string
  versionKey: string
  voteScore: number
}

export function ChordVersionVote({ songId, versionKey, voteScore }: ChordVersionVoteProps) {
  const voteMutation = useChordVote()

  const handleVote = (vote: number) => {
    voteMutation.mutate({ songId, versionKey, vote })
  }

  return (
    <div className="inline-flex items-center gap-0.5" data-testid="chord-version-vote">
      <button
        type="button"
        onClick={() => handleVote(1)}
        disabled={voteMutation.isPending}
        className={cn(
          'rounded p-0.5 transition-colors',
          'text-smoke-500 hover:text-emerald-400 hover:bg-emerald-400/10',
          'disabled:opacity-40',
        )}
        aria-label="Vote up"
        data-testid="chord-vote-up"
      >
        <ThumbsUp size={12} />
      </button>
      <span
        className={cn(
          'text-xs min-w-4 text-center tabular-nums',
          voteScore > 0 && 'text-emerald-400',
          voteScore < 0 && 'text-red-400',
          voteScore === 0 && 'text-smoke-500',
        )}
      >
        {voteScore}
      </span>
      <button
        type="button"
        onClick={() => handleVote(-1)}
        disabled={voteMutation.isPending}
        className={cn(
          'rounded p-0.5 transition-colors',
          'text-smoke-500 hover:text-red-400 hover:bg-red-400/10',
          'disabled:opacity-40',
        )}
        aria-label="Vote down"
        data-testid="chord-vote-down"
      >
        <ThumbsDown size={12} />
      </button>
    </div>
  )
}

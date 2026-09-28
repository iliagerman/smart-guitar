import { cn } from '@/lib/cn'
import type { SongDifficulty } from '@/types/song'

const STYLES: Record<SongDifficulty, string> = {
  easy: 'bg-green-500/15 text-green-300',
  medium: 'bg-flame-400/15 text-flame-300',
  hard: 'bg-fire-500/15 text-fire-300',
}

interface DifficultyBadgeProps {
  difficulty: SongDifficulty
  className?: string
}

/** Small EASY / MEDIUM / HARD pill computed from the song's easiest chord version. */
export function DifficultyBadge({ difficulty, className }: DifficultyBadgeProps) {
  return (
    <span
      className={cn('inline-block rounded-md px-1.5 py-0.5 text-[10px] font-extrabold uppercase tracking-wide', STYLES[difficulty], className)}
      data-testid={`difficulty-${difficulty}`}
    >
      {difficulty}
    </span>
  )
}

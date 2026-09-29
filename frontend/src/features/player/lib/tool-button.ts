import { cn } from '@/lib/cn'

/**
 * The compact icon-over-label button used for song tools (heart, record,
 * mixer, chord map, metronome, edit) in the song header.
 */
export function toolButtonClass(active = false, className?: string): string {
  return cn(
    'inline-flex h-11 min-w-[3rem] shrink-0 flex-col items-center justify-center gap-0.5 rounded-xl px-1.5 text-[10px] font-semibold transition-colors sm:h-12 sm:min-w-[3.4rem] sm:px-2',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-flame-400/60 disabled:cursor-not-allowed disabled:opacity-45',
    active ? 'bg-fire-500/15 text-fire-200' : 'text-smoke-300 hover:bg-white/[0.07] hover:text-smoke-100',
    className,
  )
}

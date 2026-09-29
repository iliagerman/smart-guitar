import { cn } from '@/lib/cn'

/**
 * A pill in the player dock and on the sheet bar: frosted glass that warms up
 * on hover, and lights up in fire while its setting is on.
 */
export function dockPillClass(on = false, className?: string): string {
  return cn(
    'inline-flex h-10 shrink-0 items-center gap-2 whitespace-nowrap rounded-full border px-3.5 text-sm font-semibold backdrop-blur-md',
    'transition-[background-color,border-color,color,box-shadow] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-flame-400/60',
    'disabled:cursor-not-allowed disabled:opacity-45 [&_svg]:shrink-0',
    on
      ? 'border-fire-500/45 bg-fire-500/15 text-fire-100 shadow-[0_0_22px_rgba(249,115,22,0.22)] [&_svg]:text-fire-300'
      : 'border-white/10 bg-white/[0.045] text-smoke-200 enabled:hover:border-fire-400/35 enabled:hover:bg-white/[0.08] enabled:hover:text-smoke-50 [&_svg]:text-flame-300/85',
    className,
  )
}

/** The − / + buttons inside a stepper pill. */
export const dockStepButtonClass =
  'grid size-7 place-items-center rounded-full text-smoke-200 transition-colors hover:bg-white/10 hover:text-smoke-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-flame-400/60'

/** A popover that opens from a dock pill. */
export const dockPopoverClass =
  'z-50 rounded-2xl border border-white/10 bg-stage-950/95 shadow-[0_24px_60px_rgba(0,0,0,0.6),0_0_40px_rgba(249,115,22,0.08)] backdrop-blur-xl'

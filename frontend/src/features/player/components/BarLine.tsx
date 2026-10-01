import { cn } from '@/lib/cn'

/** A thin bar line, positioned by the caller along the inline edge it marks. */
export function BarLine({ className }: { className: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn('pointer-events-none absolute inset-y-0 w-px bg-smoke-300/25', className)}
      data-testid="bar-line"
    />
  )
}

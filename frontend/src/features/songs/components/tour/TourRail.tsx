import { cn } from '@/lib/cn'

export interface TourStop {
  id: string
  label: string
  accent: string
}

interface TourRailProps {
  stops: TourStop[]
  active: string
  onJump: (id: string) => void
}

/** Desktop map of tonight's stops: where you are, and a way to jump ahead. */
export function TourRail({ stops, active, onJump }: TourRailProps) {
  return (
    <nav
      className="pointer-events-none absolute right-5 top-1/2 z-30 hidden -translate-y-1/2 xl:block"
      aria-label="Tonight’s stops"
      data-testid="tour-rail"
    >
      <ol className="pointer-events-auto flex flex-col gap-2.5">
        {stops.map((stop) => {
          const isActive = stop.id === active
          return (
            <li key={stop.id}>
              <button
                type="button"
                onClick={() => onJump(stop.id)}
                aria-current={isActive ? 'location' : undefined}
                aria-label={stop.label}
                className="group relative grid size-5 place-items-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-flame-400/70"
              >
                <span
                  className={cn(
                    'pointer-events-none absolute right-7 whitespace-nowrap rounded-full bg-stage-950/80 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.2em] text-smoke-100 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100',
                  )}
                >
                  {stop.label}
                </span>
                <span
                  className={cn('block rounded-full transition-[width,height,background-color]', isActive ? 'h-2.5 w-2.5' : 'h-1.5 w-1.5 bg-white/30')}
                  style={isActive ? { backgroundColor: stop.accent, boxShadow: `0 0 12px ${stop.accent}` } : undefined}
                />
              </button>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}

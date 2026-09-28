import { cn } from '@/lib/cn'
import { StemIcon } from '@/features/player/components/StemIcons'

const SEATS = ['vocals', 'drums', 'guitar', 'bass', 'piano'] as const

interface BandSeatsProps {
  className?: string
}

/** Decorative band row with the empty "YOU" seat where the guitarist was. */
export function BandSeats({ className }: BandSeatsProps) {
  return (
    <div className={cn('flex items-end justify-center gap-3', className)} aria-hidden="true">
      {SEATS.map((stem) =>
        stem === 'guitar' ? (
          <div key={stem} className="flex flex-col items-center gap-1">
            <div className="grid size-14 place-items-center rounded-full border-2 border-dashed border-flame-400 bg-flame-400/10 text-sm font-black text-flame-300">
              YOU
            </div>
          </div>
        ) : (
          <div
            key={stem}
            className="grid size-10 place-items-center rounded-full border-2 border-fire-500 bg-[#1b1720] text-smoke-100 shadow-[0_0_0_4px_rgba(249,115,22,0.14),0_0_16px_rgba(249,115,22,0.4)]"
          >
            <StemIcon stem={stem} size={20} />
          </div>
        ),
      )}
    </div>
  )
}

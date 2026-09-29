import { cn } from '@/lib/cn'
import { TourBackdrop } from '@/features/songs/components/tour/TourBackdrop'
import type { SceneKind } from '@/features/songs/components/tour/tour-worlds'

const BACKSTAGE: readonly SceneKind[] = ['backstage']

interface PageBackgroundProps {
  imageUrl?: string | null
  className?: string
}

/** The backstage behind every page: the home page's follow-spots, held still. */
export function PageBackground({ imageUrl, className }: PageBackgroundProps) {
  return (
    <div className={cn('pointer-events-none absolute inset-0 z-0 overflow-hidden', className)} aria-hidden="true">
      <TourBackdrop active="backstage" scenes={BACKSTAGE} still />
      {imageUrl && (
        <div className="absolute inset-0 bg-cover bg-center bg-no-repeat opacity-20 blur-lg" style={{ backgroundImage: `url(${imageUrl})` }} />
      )}
    </div>
  )
}

import { cn } from '@/lib/cn'

interface PageBackgroundProps {
  imageUrl?: string | null
  className?: string
}

export function PageBackground({ imageUrl, className }: PageBackgroundProps) {
  return (
    <div
      className={cn(
        'fixed inset-0 bg-cover bg-center bg-no-repeat opacity-20 blur-lg pointer-events-none z-0',
        className,
      )}
      style={{ backgroundImage: `url(${imageUrl || '/art/bg-texture.png'})` }}
      aria-hidden="true"
    />
  )
}

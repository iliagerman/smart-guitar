import { useEffect, useRef } from 'react'
import { mountFlameLogo } from '@/lib/flame-logo'
import { cn } from '@/lib/cn'

interface FlameLogoProps {
  /** Size classes (it is always square), e.g. "size-10". */
  className?: string
  /** Accessible name; leave empty when the logo is decorative. */
  label?: string
}

/**
 * The animated Smart Guitar mark: a guitar silhouette wrapped in live fire.
 * All logos on the page share one WebGL renderer.
 *
 * @example
 * <FlameLogo className="size-10" label="Smart Guitar" />
 */
export function FlameLogo({ className, label }: FlameLogoProps) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => mountFlameLogo(ref.current!, { src: '/art/logo-flame.jpg' }), [])

  return (
    <canvas
      ref={ref}
      className={cn('block aspect-square', className)}
      role={label ? 'img' : undefined}
      aria-label={label || undefined}
      aria-hidden={label ? undefined : true}
      data-testid="flame-logo"
    />
  )
}

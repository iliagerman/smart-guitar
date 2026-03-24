import { cn } from '@/lib/cn'

interface LoadingSpinnerProps {
  className?: string
  label?: string
  size?: 'sm' | 'md' | 'lg'
  fullScreen?: boolean
}

const sizeClasses = {
  sm: 'h-8 w-8',
  md: 'h-24 w-24',
  lg: 'h-105 w-105',
}

export function LoadingSpinner({ className, label, size = 'md', fullScreen = false }: LoadingSpinnerProps) {
  const isLarge = size === 'lg'

  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-4',
        fullScreen && 'fixed inset-0 z-50 bg-black/80',
        className,
      )}
    >
      {isLarge ? (
        <video
          src="/guitar.mp4"
          autoPlay
          loop
          muted
          playsInline
          aria-hidden="true"
          className="h-105 w-105 object-cover"
          style={{
            maskImage: 'radial-gradient(circle, black 35%, transparent 65%)',
            WebkitMaskImage: 'radial-gradient(circle, black 35%, transparent 65%)',
          }}
        />
      ) : (
        <video
          src="/guitar.mp4"
          autoPlay
          loop
          muted
          playsInline
          aria-hidden="true"
          className={cn('object-cover', size === 'sm' && 'rounded-full', sizeClasses[size])}
        />
      )}
      {label && (
        <span className={cn(
          'text-smoke-300',
          isLarge ? 'text-lg' : size === 'md' ? 'text-base' : 'text-sm',
        )}>
          {label}
        </span>
      )}
    </div>
  )
}

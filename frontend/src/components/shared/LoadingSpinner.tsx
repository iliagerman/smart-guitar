import { cn } from '@/lib/cn'
import { FlameLogo } from './FlameLogo'

interface LoadingSpinnerProps {
  className?: string
  label?: string
  size?: 'xs' | 'sm' | 'md' | 'lg'
  fullScreen?: boolean
  inline?: boolean
}

const sizeClasses = {
  xs: 'h-4 w-4',
  sm: 'h-8 w-8',
  md: 'h-24 w-24',
  // Fits a phone's width; full size from sm up.
  lg: 'size-72 sm:size-105',
}

export function LoadingSpinner({ className, label, size = 'md', fullScreen = false, inline = false }: LoadingSpinnerProps) {
  const isLarge = size === 'lg'

  const logo = <FlameLogo className={cn(sizeClasses[size], inline && className)} />

  if (inline) {
    return logo
  }

  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-4',
        fullScreen && 'fixed inset-0 z-50 bg-black/80',
        className,
      )}
    >
      {logo}
      {label && (
        <span className={cn(
          'text-smoke-300',
          isLarge ? 'text-lg' : size === 'md' ? 'text-base' : size === 'sm' ? 'text-sm' : 'text-xs',
        )}>
          {label}
        </span>
      )}
    </div>
  )
}

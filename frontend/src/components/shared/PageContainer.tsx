import { cn } from '@/lib/cn'

interface PageContainerProps {
  children: React.ReactNode
  className?: string
}

export function PageContainer({ children, className }: PageContainerProps) {
  return (
    <div className={cn('relative z-10 max-w-5xl mx-auto px-4 py-6 w-full', className)}>
      {children}
    </div>
  )
}

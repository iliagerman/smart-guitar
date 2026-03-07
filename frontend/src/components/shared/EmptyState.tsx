import { cn } from '@/lib/cn'

interface EmptyStateProps {
  icon?: React.ReactNode
  title: string
  description?: string
  action?: React.ReactNode
  className?: string
}

export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-4 p-8 text-center', className)}>
      {icon && <div className="text-smoke-500">{icon}</div>}
      <h3 className="text-lg font-semibold text-smoke-300">{title}</h3>
      {description && <p className="text-sm text-smoke-500 max-w-xs">{description}</p>}
      {action}
    </div>
  )
}

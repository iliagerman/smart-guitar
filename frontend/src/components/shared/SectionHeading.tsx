import { cn } from '@/lib/cn'

interface SectionHeadingProps {
  title: string
  className?: string
}

export function SectionHeading({ title, className }: SectionHeadingProps) {
  return (
    <h2 className={cn('text-sm font-semibold text-smoke-400 uppercase tracking-wider mb-3', className)}>
      {title}
    </h2>
  )
}

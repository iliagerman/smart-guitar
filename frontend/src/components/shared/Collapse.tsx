import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

interface CollapseProps {
  open: boolean
  children: ReactNode
  className?: string
}

/**
 * Folds its content away (height and fade) without unmounting it, so state
 * survives; folded content is inert, so it can't be focused or tapped.
 */
export function Collapse({ open, children, className }: CollapseProps) {
  return (
    <div
      className={cn(
        'grid transition-[grid-template-rows,opacity] duration-300 ease-out motion-reduce:transition-none',
        open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0',
        className,
      )}
      inert={!open}
    >
      <div className="min-h-0 overflow-hidden">{children}</div>
    </div>
  )
}

import type { JobStatus } from '@/types/job'
import { cn } from '@/lib/cn'

interface JobStatusBadgeProps {
  status: JobStatus
}

export function JobStatusBadge({ status }: JobStatusBadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center px-2 py-0.5 rounded text-xs font-medium',
        status === 'COMPLETED' && 'bg-green-500/20 text-green-400',
        status === 'PENDING' && 'bg-flame-500/20 text-flame-400',
        status === 'FAILED' && 'bg-red-500/20 text-red-400'
      )}
    >
      {status === 'PENDING' && (
        <span className="mr-1 h-1.5 w-1.5 rounded-full bg-flame-400 animate-pulse" />
      )}
      {status.toLowerCase()}
    </span>
  )
}

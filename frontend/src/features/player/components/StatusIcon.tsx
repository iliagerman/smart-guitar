import { Check, Loader2 } from 'lucide-react'

export type StepStatus = 'completed' | 'in_progress' | 'pending'

interface StatusIconProps {
  status: StepStatus
}

/**
 * Shared status indicator icon used in processing checklists.
 * Shows a checkmark for completed, spinner for in-progress, or empty circle for pending.
 */
export function StatusIcon({ status }: StatusIconProps) {
  if (status === 'completed') {
    return (
      <div className="flex items-center justify-center size-5 rounded-full bg-emerald-500/20 text-emerald-400">
        <Check size={14} strokeWidth={3} />
      </div>
    )
  }
  if (status === 'in_progress') {
    return (
      <div className="flex items-center justify-center size-5 text-flame-400">
        <Loader2 size={14} className="animate-spin" />
      </div>
    )
  }
  return (
    <div className="flex items-center justify-center size-5 rounded-full border-2 border-charcoal-600" />
  )
}

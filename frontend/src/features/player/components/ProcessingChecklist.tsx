import { useState } from 'react'
import { Check, Flame, Loader2 } from 'lucide-react'
import { useCreateJob } from '../hooks/use-create-job'
import { useJobPolling } from '../hooks/use-job-polling'
import { cn } from '@/lib/cn'

interface ProcessingChecklistProps {
  songId: string
  hasChords: boolean
  hasTabs: boolean
  hasStemsProcessed: boolean
  stemNames: string[]
  isGeneratingTabs: boolean
  isGeneratingChords: boolean
}

type StepStatus = 'completed' | 'in_progress' | 'pending'

interface Step {
  label: string
  status: StepStatus
  action?: () => void
  progress?: number | null
  stage?: string | null
}

function StatusIcon({ status }: { status: StepStatus }) {
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

export function ProcessingChecklist({
  songId,
  hasChords,
  hasTabs,
  hasStemsProcessed,
  stemNames,
  isGeneratingTabs,
  isGeneratingChords,
}: ProcessingChecklistProps) {
  const [jobId, setJobId] = useState<string | null>(null)
  const createJob = useCreateJob()
  const { data: job } = useJobPolling(jobId)

  const isProcessingStems = job?.status === 'PENDING' || job?.status === 'PROCESSING' || createJob.isPending
  const stemProgress = typeof job?.progress === 'number' ? job.progress : null
  const stemFailed = job?.status === 'FAILED'

  const handleProcessStems = () => {
    createJob.mutate(
      { songId, descriptions: stemNames },
      { onSuccess: (job) => setJobId(job.id) },
    )
  }

  const steps: Step[] = [
    {
      label: 'Generate chords',
      status: hasChords ? 'completed' : isGeneratingChords ? 'in_progress' : 'pending',
    },
    {
      label: 'Generate tabs',
      status: hasTabs ? 'completed' : isGeneratingTabs ? 'in_progress' : 'pending',
    },
    {
      label: 'Process stems',
      status: hasStemsProcessed ? 'completed' : isProcessingStems ? 'in_progress' : 'pending',
      action: !hasStemsProcessed && !isProcessingStems ? handleProcessStems : undefined,
      progress: stemProgress,
      stage: job?.stage,
    },
  ]

  return (
    <div className="flex flex-col gap-1 w-full">
      {steps.map((step) => (
        <div key={step.label} className="flex flex-col">
          <div className="flex items-center gap-2.5 py-1.5">
            <StatusIcon status={step.status} />
            <span
              className={cn(
                'text-sm',
                step.status === 'completed' && 'text-smoke-300 line-through decoration-smoke-600',
                step.status === 'in_progress' && 'text-smoke-100',
                step.status === 'pending' && 'text-smoke-400',
              )}
            >
              {step.label}
            </span>

            {step.status === 'in_progress' && step.progress !== null && step.progress !== undefined && (
              <span className="ml-auto text-xs text-smoke-400 tabular-nums">
                {Math.round(step.progress)}%
              </span>
            )}

            {step.action && step.status === 'pending' && (
              <button
                onClick={step.action}
                className="ml-auto flex items-center gap-1.5 px-3 py-1 text-xs font-semibold rounded-md bg-flame-400 text-charcoal-950 hover:bg-flame-500 transition-colors"
              >
                <Flame size={12} />
                Start
              </button>
            )}

            {stemFailed && step.label === 'Process stems' && (
              <button
                onClick={handleProcessStems}
                className="ml-auto flex items-center gap-1.5 px-3 py-1 text-xs font-semibold rounded-md bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors"
              >
                Retry
              </button>
            )}
          </div>

          {step.status === 'in_progress' && step.progress !== null && step.progress !== undefined && (
            <div className="ml-7.5 mb-1">
              {step.stage && (
                <span className="text-xs text-smoke-500 capitalize">{step.stage.replaceAll('_', ' ')}</span>
              )}
              <div className="mt-0.5 h-1.5 w-full rounded-full bg-charcoal-800 overflow-hidden">
                <div
                  className="h-full bg-flame-400 transition-[width] duration-300"
                  style={{ width: `${Math.min(100, Math.max(0, step.progress))}%` }}
                />
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

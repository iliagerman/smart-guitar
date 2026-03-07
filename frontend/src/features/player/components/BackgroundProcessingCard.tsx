import { Check, Loader2 } from 'lucide-react'
import { cn } from '@/lib/cn'
import { useJobPolling } from '../hooks/use-job-polling'
import { useJobStatusUrl } from '../hooks/use-job-status-url'
import { useJobStatusManifest } from '../hooks/use-job-status-manifest'

type StepStatus = 'completed' | 'in_progress' | 'pending'

interface BackgroundProcessingCardProps {
    jobId: string | null
    show: boolean
    hasLyrics: boolean
    hasTabs: boolean
    showTabsStep: boolean
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

function stepStatus(past: boolean, active: boolean): StepStatus {
    if (past) return 'completed'
    if (active) return 'in_progress'
    return 'pending'
}

export function BackgroundProcessingCard({
    jobId,
    show,
    hasLyrics,
    hasTabs,
    showTabsStep,
}: BackgroundProcessingCardProps) {
    const { data: job } = useJobPolling(jobId)
    const { data: statusUrl } = useJobStatusUrl(jobId)

    const jobStage = job?.stage ?? null
    const isProcessing = job?.status === 'PENDING' || job?.status === 'PROCESSING'
    const isFailed = job?.status === 'FAILED'

    const manifestPollingEnabled = !!jobId && isProcessing && !isFailed
    const { data: manifest } = useJobStatusManifest(statusUrl?.url ?? null, manifestPollingEnabled)

    const stage = (manifest?.stage ?? jobStage ?? null)
    const progress = typeof manifest?.progress === 'number'
        ? manifest.progress
        : typeof job?.progress === 'number'
            ? job.progress
            : null

    // When the song is already interactive, the backend may still be producing lyrics/tabs.
    // This card keeps the same checklist UX without blocking playback.
    if (!show) return null

    // If we have a job, only show the card while it could still be affecting lyrics/tabs.
    // If we don't have a jobId, we still show pending steps while the detail query polls.
    const laterStages = (stages: string[]) => (stage ? stages.includes(stage) : false)

    const shouldShowLyrics = !hasLyrics
    const shouldShowTabs = showTabsStep && !hasTabs

    const pastLyrics = hasLyrics || laterStages(['generating_tabs', 'saving_results', 'completed'])
    const pastTabs = hasTabs || laterStages(['saving_results', 'completed'])

    const anyMissing = shouldShowLyrics || shouldShowTabs
    if (!anyMissing) return null

    const steps = [
        shouldShowLyrics
            ? {
                label: 'Transcribe lyrics',
                status: stepStatus(pastLyrics, (jobId ? isProcessing : true) && !pastLyrics),
            }
            : null,
        shouldShowTabs
            ? {
                label: 'Generate tabs',
                status: stepStatus(pastTabs, (jobId ? isProcessing : true) && !pastTabs),
            }
            : null,
    ].filter(Boolean) as { label: string; status: StepStatus }[]

    return (
        <div
            className="rounded-lg border border-charcoal-700 bg-charcoal-900/40 px-3 py-2 text-sm text-smoke-300 mb-3"
            aria-live="polite"
            data-testid="background-processing-card"
        >
            <div className="flex items-center gap-2">
                <div
                    className={cn(
                        'h-4 w-4 rounded-full border-2 border-charcoal-600 shrink-0',
                        isFailed ? 'border-red-500/40' : 'border-t-flame-400 animate-spin',
                    )}
                />
                <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-3">
                        <span className={cn('font-medium', isFailed && 'text-red-400')}>
                            {isFailed ? 'Background generation failed' : 'Generating in background'}
                        </span>
                        {progress !== null && !isFailed && (
                            <span className="text-xs text-smoke-400 tabular-nums">
                                {Math.round(progress)}%
                            </span>
                        )}
                    </div>
                    {stage && !isFailed && (
                        <div className="text-xs text-smoke-500 capitalize">
                            {stage.replaceAll('_', ' ')}
                        </div>
                    )}
                </div>
            </div>

            <div className="mt-2 flex flex-col gap-1">
                {steps.map((s) => (
                    <div key={s.label} className="flex items-center gap-2.5 py-0.5">
                        <StatusIcon status={s.status} />
                        <span
                            className={cn(
                                'text-sm',
                                s.status === 'completed' && 'text-smoke-300 line-through decoration-smoke-600',
                                s.status === 'in_progress' && 'text-smoke-100',
                                s.status === 'pending' && 'text-smoke-400',
                            )}
                        >
                            {s.label}
                        </span>
                    </div>
                ))}

                {isFailed && job?.error_message && (
                    <div className="ml-7.5 text-xs text-red-400">
                        {job.error_message}
                    </div>
                )}
            </div>
        </div>
    )
}

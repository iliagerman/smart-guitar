import { useState, useEffect, useRef, useCallback } from 'react'
import { RotateCcw } from 'lucide-react'
import { useCreateJob } from '../hooks/use-create-job'
import { useJobPolling } from '../hooks/use-job-polling'
import { useJobStatusUrl } from '../hooks/use-job-status-url'
import { useJobStatusManifest } from '../hooks/use-job-status-manifest'
import { useJobWatcherStore } from '@/stores/job-watcher.store'
import { requestNotificationPermission } from '@/lib/notify'
import { cn } from '@/lib/cn'
import { StatusIcon, type StepStatus } from './StatusIcon'
import { ProgressRing, SpinnerRing } from './ProgressRing'

interface ProcessButtonProps {
  songId: string
  songTitle: string
  songArtist: string
  hasStemsProcessed: boolean
  hasChords: boolean
  hasLyrics: boolean
  hasTabs: boolean
  stemNames: string[]
  activeJobId?: string | null
  downloadPending?: boolean
}

function stepStatus(past: boolean, active: boolean): StepStatus {
  if (past) return 'completed'
  if (active) return 'in_progress'
  return 'pending'
}

export function ProcessButton({
  songId,
  songTitle,
  songArtist,
  hasStemsProcessed,
  hasChords,
  hasLyrics,
  hasTabs,
  stemNames,
  activeJobId,
  downloadPending,
}: ProcessButtonProps) {
  const [jobId, setJobId] = useState<string | null>(activeJobId ?? null)
  const createJob = useCreateJob()
  const { data: job } = useJobPolling(jobId)
  const { data: statusUrl } = useJobStatusUrl(jobId)
  const started = useRef(false)
  const watchJob = useJobWatcherStore((s) => s.watchJob)

  const isFailed = job?.status === 'FAILED'
  const jobDone = job?.status === 'COMPLETED'
  const coreReady = hasStemsProcessed && hasChords
  const shouldDismiss = coreReady || jobDone

  useEffect(() => {
    if (activeJobId) {
      setJobId(activeJobId)
      watchJob({ jobId: activeJobId, songId, songTitle, songArtist })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeJobId])

  const handleRetry = useCallback(() => {
    setJobId(null)
    started.current = false
    requestNotificationPermission()
    createJob.mutate(
      { songId, descriptions: stemNames },
      {
        onSuccess: (j) => {
          setJobId(j.id)
          watchJob({ jobId: j.id, songId, songTitle, songArtist })
        },
      },
    )
  }, [songId, songTitle, songArtist, stemNames, createJob, watchJob])

  useEffect(() => {
    if (hasStemsProcessed || coreReady || jobId || started.current || downloadPending) return
    started.current = true
    requestNotificationPermission()
    createJob.mutate(
      { songId, descriptions: stemNames },
      {
        onSuccess: (j) => {
          setJobId(j.id)
          watchJob({ jobId: j.id, songId, songTitle, songArtist })
        },
      },
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const [dismissed, setDismissed] = useState(false)

  const manifestPollingEnabled = !!jobId && !dismissed && !shouldDismiss && !isFailed
  const { data: manifest } = useJobStatusManifest(statusUrl?.url ?? null, manifestPollingEnabled)

  useEffect(() => {
    if (shouldDismiss && jobId && !dismissed) {
      const timer = setTimeout(() => setDismissed(true), 2000)
      return () => clearTimeout(timer)
    }
  }, [shouldDismiss, jobId, dismissed])

  if (hasStemsProcessed && !jobId && !downloadPending) return null
  if (coreReady) return null
  if (dismissed) return null

  if (downloadPending && !jobId) {
    return (
      <SpinnerRing
        label="Downloading audio..."
        sublabel="Processing will start automatically"
      />
    )
  }

  const isProcessing = job?.status === 'PENDING' || job?.status === 'PROCESSING' || createJob.isPending
  const rawProgress = typeof job?.progress === 'number' ? job.progress : 0
  const manifestProgress = typeof manifest?.progress === 'number' ? manifest.progress : null
  const isCompleted = shouldDismiss
  const displayProgress = isCompleted ? 100 : (manifestProgress ?? rawProgress)
  const jobStage = (manifest?.stage ?? job?.stage ?? '')

  const laterStages = (stages: string[]) => stages.includes(jobStage)
  const pastSeparating = hasStemsProcessed || laterStages(['recognizing_chords', 'transcribing_lyrics', 'generating_tabs', 'saving_results', 'completed'])
  const pastChords = hasChords || laterStages(['transcribing_lyrics', 'generating_tabs', 'saving_results', 'completed'])
  const pastLyrics = hasLyrics || laterStages(['generating_tabs', 'saving_results', 'completed'])
  const pastTabs = hasTabs || laterStages(['saving_results', 'completed'])

  const steps = [
    { label: 'Separate stems', status: stepStatus(pastSeparating, isProcessing && !pastSeparating) },
    { label: 'Recognize chords', status: stepStatus(pastChords, isProcessing && !pastChords) },
    { label: 'Transcribe lyrics', status: stepStatus(pastLyrics, isProcessing && pastChords && !pastLyrics) },
    { label: 'Generate tabs', status: stepStatus(pastTabs, isProcessing && pastChords && !pastTabs) },
  ]

  const stage = manifest?.stage ?? job?.stage ?? null

  return (
    <div
      className={cn(
        'flex flex-1 flex-col items-center justify-center gap-6 py-8 transition-opacity duration-500',
        isCompleted && 'opacity-0',
      )}
      data-testid="process-button-container"
      role="status"
      aria-label={isCompleted ? 'Processing complete' : isFailed ? 'Processing failed' : `Processing ${Math.round(displayProgress)}%`}
    >
      <ProgressRing
        progress={displayProgress}
        isFailed={isFailed}
        isCompleted={isCompleted}
        stage={stage}
      />

      <div className="text-center space-y-1">
        <p className="text-smoke-300 text-sm">
          Generation takes about 5 minutes
        </p>
        <p className="text-smoke-500 text-xs">
          Feel free to browse — we'll notify you when it's ready
        </p>
      </div>

      {isFailed && (
        <div className="flex flex-col items-center gap-3">
          <p className="text-red-400 text-sm text-center">
            {job.error_message || 'Processing failed'}
          </p>
          <button
            onClick={handleRetry}
            disabled={createJob.isPending}
            className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg bg-flame-500/20 text-flame-400 hover:bg-flame-500/30 transition-colors disabled:opacity-50"
            aria-label="Retry processing"
            data-testid="process-retry-button"
          >
            <RotateCcw size={14} />
            Retry
          </button>
        </div>
      )}

      <div className="flex flex-col gap-1 w-full max-w-xs">
        {steps.map((step) => (
          <div key={step.label} className="flex items-center gap-2.5 py-1">
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
          </div>
        ))}
      </div>
    </div>
  )
}

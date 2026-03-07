import { useState, useEffect, useRef, useCallback } from 'react'
import { Check, Loader2, RotateCcw } from 'lucide-react'
import { useCreateJob } from '../hooks/use-create-job'
import { useJobPolling } from '../hooks/use-job-polling'
import { useJobStatusUrl } from '../hooks/use-job-status-url'
import { useJobStatusManifest } from '../hooks/use-job-status-manifest'
import { useJobWatcherStore } from '@/stores/job-watcher.store'
import { requestNotificationPermission } from '@/lib/notify'
import { cn } from '@/lib/cn'

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
}

const RING_SIZE = 144
const RADIUS = 62
const STROKE = 5
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

type StepStatus = 'completed' | 'in_progress' | 'pending'

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
  // Dismiss when core data (stems + chords) is ready for interaction,
  // or when the backend job finishes. Tabs/lyrics continue in background.
  const shouldDismiss = coreReady || jobDone

  // Register an already-active job with the watcher (e.g. page reload while processing).
  useEffect(() => {
    if (activeJobId) {
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

  // Auto-start generation on mount when stems haven't been processed yet.
  // If stems+chords already exist, don't re-run the full pipeline — the
  // backend retries missing lyrics/tabs in the background automatically.
  useEffect(() => {
    if (hasStemsProcessed || coreReady || jobId || started.current) return
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
    // Only run once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Delay unmount so the user sees the ring fill to 100%.
  const [dismissed, setDismissed] = useState(false)

  const manifestPollingEnabled = !!jobId && !dismissed && !shouldDismiss && !isFailed
  const { data: manifest } = useJobStatusManifest(statusUrl?.url ?? null, manifestPollingEnabled)

  useEffect(() => {
    if (shouldDismiss && jobId && !dismissed) {
      const timer = setTimeout(() => setDismissed(true), 2000)
      return () => clearTimeout(timer)
    }
  }, [shouldDismiss, jobId, dismissed])

  // Already processed (stems exist) before this mount (e.g. page reload).
  // Missing lyrics/tabs are handled by background retries, not a new job.
  if (hasStemsProcessed && !jobId) return null
  // Core data ready — dismiss immediately so user can interact with chords/stems.
  if (coreReady) return null
  // Job finished (with or without all data) — dismiss after delay.
  if (dismissed) return null

  const isProcessing = job?.status === 'PENDING' || job?.status === 'PROCESSING' || createJob.isPending
  const rawProgress = typeof job?.progress === 'number' ? job.progress : 0
  const manifestProgress = typeof manifest?.progress === 'number' ? manifest.progress : null
  const isCompleted = shouldDismiss
  const displayProgress = isCompleted ? 100 : (manifestProgress ?? rawProgress)

  const dashOffset = CIRCUMFERENCE - (CIRCUMFERENCE * displayProgress) / 100

  // Derive step statuses from the job stage and data availability.
  // Enforce monotonic ordering: a later step can only be "done" if all prior steps are too.
  // This prevents stale data from a previous job (e.g. chords exist) from marking a step
  // complete while the current job is still on an earlier stage.
  const jobStage = (manifest?.stage ?? job?.stage ?? '')

  // Map backend stages to checklist progress.
  // Stems first, then chords, then lyrics + tabs in parallel after chords.
  // Each step is "past" when its data exists OR the job has moved beyond that stage.
  // Data availability is the most reliable signal — if the data exists, the step is done.
  const laterStages = (stages: string[]) => stages.includes(jobStage)
  const pastSeparating = hasStemsProcessed || laterStages(['recognizing_chords', 'transcribing_lyrics', 'generating_tabs', 'saving_results', 'completed'])
  const pastChords = hasChords || laterStages(['transcribing_lyrics', 'generating_tabs', 'saving_results', 'completed'])
  const pastLyrics = hasLyrics || laterStages(['generating_tabs', 'saving_results', 'completed'])
  const pastTabs = hasTabs || laterStages(['saving_results', 'completed'])

  function stepStatus(past: boolean, active: boolean): StepStatus {
    if (past) return 'completed'
    if (active) return 'in_progress'
    return 'pending'
  }

  // Stems first; chords start after stems; lyrics + tabs start after chords
  const steps = [
    { label: 'Separate stems', status: stepStatus(pastSeparating, isProcessing && !pastSeparating) },
    { label: 'Recognize chords', status: stepStatus(pastChords, isProcessing && !pastChords) },
    { label: 'Transcribe lyrics', status: stepStatus(pastLyrics, isProcessing && pastChords && !pastLyrics) },
    { label: 'Generate tabs', status: stepStatus(pastTabs, isProcessing && pastChords && !pastTabs) },
  ]

  return (
    <div
      className={cn(
        'flex flex-1 flex-col items-center justify-center gap-6 py-8 transition-opacity duration-500',
        isCompleted && 'opacity-0',
      )}
    >
      {/* Circular progress indicator */}
      <div className="relative flex items-center justify-center">
        <svg
          className="absolute"
          width={RING_SIZE}
          height={RING_SIZE}
          viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`}
        >
          <circle
            cx={RING_SIZE / 2}
            cy={RING_SIZE / 2}
            r={RADIUS}
            fill="none"
            stroke="currentColor"
            className="text-charcoal-700"
            strokeWidth={STROKE}
          />
          <circle
            cx={RING_SIZE / 2}
            cy={RING_SIZE / 2}
            r={RADIUS}
            fill="none"
            stroke="currentColor"
            className={cn(
              'transition-[stroke-dashoffset] duration-700 ease-out',
              isFailed ? 'text-red-400' : 'text-flame-400',
            )}
            strokeWidth={STROKE}
            strokeLinecap="round"
            strokeDasharray={CIRCUMFERENCE}
            strokeDashoffset={dashOffset}
            transform={`rotate(-90 ${RING_SIZE / 2} ${RING_SIZE / 2})`}
          />
        </svg>

        <div
          className="relative z-10 flex items-center justify-center rounded-full size-28 bg-charcoal-800 border-2 border-charcoal-600"
        >
          {isCompleted ? (
            <span className="text-flame-400 font-bold text-sm">Done!</span>
          ) : isFailed ? (
            <span className="text-red-400 font-bold text-sm">Failed</span>
          ) : (
            <div className="flex flex-col items-center gap-1">
              <span className="text-flame-400 text-lg font-bold">
                {Math.round(displayProgress)}%
              </span>
              <span className="text-smoke-400 text-[10px] capitalize leading-tight text-center px-2">
                {(manifest?.stage ?? job?.stage)?.replaceAll('_', ' ') || 'starting'}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Subtitle */}
      <div className="text-center space-y-1">
        <p className="text-smoke-300 text-sm">
          Generation takes about 5 minutes
        </p>
        <p className="text-smoke-500 text-xs">
          Feel free to browse — we'll notify you when it's ready
        </p>
      </div>

      {/* Failed state */}
      {isFailed && (
        <div className="flex flex-col items-center gap-3">
          <p className="text-red-400 text-sm text-center">
            {job.error_message || 'Processing failed'}
          </p>
          <button
            onClick={handleRetry}
            disabled={createJob.isPending}
            className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg bg-flame-500/20 text-flame-400 hover:bg-flame-500/30 transition-colors disabled:opacity-50"
          >
            <RotateCcw size={14} />
            Retry
          </button>
        </div>
      )}

      {/* Checklist */}
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

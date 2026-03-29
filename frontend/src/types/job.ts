/** Const object for job status values. Use `JobStatus.PENDING` etc. instead of raw strings. */
export const JobStatus = {
  PENDING: 'PENDING',
  PROCESSING: 'PROCESSING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
} as const

export type JobStatus = (typeof JobStatus)[keyof typeof JobStatus]

export interface JobResult {
  description: string
  target_key: string
  residual_key: string
}

export interface Job {
  id: string
  user_id: string
  song_id: string
  status: JobStatus
  progress?: number | null
  stage?: string | null
  descriptions: string[]
  mode: string
  error_message: string | null
  results: JobResult[] | null
  created_at: string
  updated_at: string
  completed_at: string | null
}

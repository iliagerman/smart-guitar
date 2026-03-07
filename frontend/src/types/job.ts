export type JobStatus = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED'

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

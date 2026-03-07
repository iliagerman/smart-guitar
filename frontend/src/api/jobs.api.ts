import { api } from '../config/api'
import type { Job } from '../types/job'
import type { JobStatusUrlResponse } from '../types/job-status'

export const jobsApi = {
  create: (songId: string, descriptions: string[], mode = 'isolate') =>
    api.post<Job>('/api/v1/jobs', { song_id: songId, descriptions, mode }).then((r) => r.data),

  get: (jobId: string) =>
    api.get<Job>(`/api/v1/jobs/${jobId}`).then((r) => r.data),

  getStatusUrl: (jobId: string) =>
    api.get<JobStatusUrlResponse>(`/api/v1/jobs/${jobId}/status-url`).then((r) => r.data),

  list: () =>
    api.get<Job[]>('/api/v1/jobs').then((r) => r.data),
}

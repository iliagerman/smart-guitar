export interface JobStatusUrlResponse {
    job_id: string
    manifest_key: string
    url: string
}

// The manifest shape is produced by the orchestrator. Keep it permissive on the client
// so we can evolve it without breaking older frontends.
export type JobStatusManifest = {
    job_id?: string
    stage?: string
    progress?: number
    status?: string
    updated_at?: string
} & Record<string, unknown>

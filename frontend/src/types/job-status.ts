export interface JobStatusUrlResponse {
    job_id: string
    manifest_key: string
    url: string
}

/** The manifest shape is produced by the orchestrator. Kept permissive so we can
 *  evolve it without breaking older frontends. */
export interface JobStatusManifest {
    job_id?: string
    stage?: string
    progress?: number
    status?: string
    updated_at?: string
    [key: string]: unknown
}

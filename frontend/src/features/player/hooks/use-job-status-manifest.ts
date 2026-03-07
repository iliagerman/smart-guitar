import { useQuery } from '@tanstack/react-query'
import { queryKeys } from '@/api/query-keys'
import type { JobStatusManifest } from '@/types/job-status'

async function fetchMaybeJson(url: string): Promise<JobStatusManifest | null> {
    const resp = await fetch(url, {
        // Make sure the browser doesn't reuse a cached 404/old manifest.
        cache: 'no-store',
    })

    if (!resp.ok) {
        return null
    }

    const text = await resp.text()
    if (!text) return null

    try {
        return JSON.parse(text) as JobStatusManifest
    } catch {
        // S3 404s are typically XML; treat as "not ready".
        return null
    }
}

export function useJobStatusManifest(url: string | null, enabled: boolean) {
    return useQuery({
        queryKey: queryKeys.jobs.statusManifest(url ?? ''),
        queryFn: () => fetchMaybeJson(url!),
        enabled: !!url && enabled,
        refetchInterval: enabled ? 7_000 : false,
        // Only trigger re-renders when meaningful fields change.
        // The manifest includes noise like `updated_at` that rotates every poll
        // even when progress/stage/status are unchanged.
        structuralSharing: (oldData, newData) => {
            if (!oldData || !newData) return newData ?? oldData
            const old = oldData as JobStatusManifest
            const cur = newData as JobStatusManifest
            if (
                old.progress === cur.progress &&
                old.stage === cur.stage &&
                old.status === cur.status
            ) {
                return oldData
            }
            return newData
        },
    })
}

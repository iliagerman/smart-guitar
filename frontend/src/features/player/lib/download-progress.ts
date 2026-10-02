/** Download progress for the multi-stem player, which waits for every stem before playing. */

export interface DownloadState {
  received: number
  total: number
}

/**
 * The response body, reporting (bytes received, total bytes) after each chunk
 * when the server sent a Content-Length (a CORS-safelisted header).
 */
export async function downloadWithProgress(
  response: Response,
  onProgress: (received: number, total: number) => void,
): Promise<ArrayBuffer> {
  const total = Number(response.headers.get('Content-Length')) || 0
  if (!total || !response.body) return response.arrayBuffer()

  const chunks: Uint8Array[] = []
  let received = 0
  const reader = response.body.getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    received += value.byteLength
    onProgress(Math.min(received, total), total)
  }
  const data = new Uint8Array(received)
  let offset = 0
  for (const chunk of chunks) {
    data.set(chunk, offset)
    offset += chunk.byteLength
  }
  return data.buffer
}

/** Whole-number percent of all downloads; 99 at most, since decoding follows. Null with none. */
export function overallPercent(downloads: readonly DownloadState[]): number | null {
  const total = downloads.reduce((sum, d) => sum + d.total, 0)
  if (!total) return null
  const received = downloads.reduce((sum, d) => sum + d.received, 0)
  return Math.min(99, Math.floor((100 * received) / total))
}

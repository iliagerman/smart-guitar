import { describe, expect, it } from 'vitest'

import { downloadWithProgress, overallPercent } from './download-progress'

function streamed(chunks: number[], contentLength: number | null): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const size of chunks) controller.enqueue(new Uint8Array(size))
      controller.close()
    },
  })
  return new Response(body, { headers: contentLength === null ? {} : { 'Content-Length': String(contentLength) } })
}

describe('downloadWithProgress', () => {
  it('reports the bytes received against the size as the body arrives', async () => {
    const seen: [number, number][] = []
    const data = await downloadWithProgress(streamed([3, 4, 3], 10), (received, total) => seen.push([received, total]))
    expect(data.byteLength).toBe(10)
    expect(seen).toEqual([[3, 10], [7, 10], [10, 10]])
  })

  it('still returns the whole body when the size is unknown', async () => {
    const seen: number[] = []
    const data = await downloadWithProgress(streamed([5, 5], null), (received) => seen.push(received))
    expect(data.byteLength).toBe(10)
    expect(seen).toEqual([])
  })
})

describe('overallPercent', () => {
  it('weighs each download by its size and stays under 100 until all are decoded', () => {
    expect(overallPercent([{ received: 5, total: 10 }, { received: 0, total: 30 }])).toBe(12)
    expect(overallPercent([{ received: 10, total: 10 }])).toBe(99)
    expect(overallPercent([])).toBeNull()
  })
})

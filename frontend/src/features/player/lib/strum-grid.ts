import type { RhythmInfo, StrumEvent } from '@/types/song'

export type GridMode = 'beat' | '8ths' | '16ths' | 'auto'
export type Subdivision = 1 | 2 | 4

export interface GridSlot {
    time: number
    beatIndex: number // 0-based within this window
    subIndex: number // 0..(subdivision-1)
    label: string | null
}

export interface QuantizedStrum {
    time: number
    direction: 'down' | 'up'
    confidence: number
}

const MAX_SNAP_S = 0.12

function subdivisionFromMode(mode: Exclude<GridMode, 'auto'>): Subdivision {
    switch (mode) {
        case 'beat':
            return 1
        case '8ths':
            return 2
        case '16ths':
            return 4
    }
}

function mean(values: number[]): number {
    if (values.length === 0) return Infinity
    return values.reduce((a, b) => a + b, 0) / values.length
}

function countLabel(subdivision: Subdivision, beatNumber1Based: number, subIndex: number): string | null {
    if (subdivision === 1) return String(beatNumber1Based)
    if (subdivision === 2) return subIndex === 0 ? String(beatNumber1Based) : '&'
    // 16ths
    if (subIndex === 0) return String(beatNumber1Based)
    if (subIndex === 1) return 'e'
    if (subIndex === 2) return '&'
    return 'a'
}

function getBeatsInRange(rhythm: RhythmInfo, start: number, end: number): number[] {
    const beats = rhythm.beat_times
    // Include a tiny margin so we can build subdivisions at the window edges.
    const margin = 0.5
    return beats.filter((t) => t >= start - margin && t <= end + margin)
}

export function buildGridSlots(
    start: number,
    end: number,
    rhythm: RhythmInfo,
    subdivision: Subdivision
): GridSlot[] {
    const beats = getBeatsInRange(rhythm, start, end)
    if (beats.length === 0) return []

    const slots: GridSlot[] = []
    let beatIndex = 0

    for (let i = 0; i < beats.length; i++) {
        const bt = beats[i]
        if (bt >= end) break

        // Compute the next beat time for interpolation.
        const next = beats[i + 1]
        const beatDur = typeof next === 'number' && next > bt ? next - bt : 60 / Math.max(30, rhythm.bpm || 120)

        // Skip beats that are fully before the window.
        if (bt + beatDur <= start) continue

        const beatNumber = ((beatIndex % 4) + 1) // show familiar 1-4 cycling

        for (let si = 0; si < subdivision; si++) {
            const t = bt + (beatDur * si) / subdivision
            if (t < start || t >= end) continue
            slots.push({
                time: t,
                beatIndex,
                subIndex: si,
                label: countLabel(subdivision, beatNumber, si),
            })
        }

        beatIndex += 1
    }

    return slots.sort((a, b) => a.time - b.time)
}

function quantizeErrorForSubdivision(
    strums: StrumEvent[],
    start: number,
    end: number,
    rhythm: RhythmInfo,
    subdivision: Subdivision
): number {
    const slots = buildGridSlots(start, end, rhythm, subdivision)
    if (slots.length === 0) return Infinity

    const slotTimes = slots.map((s) => s.time)

    const errors: number[] = []
    for (const s of strums) {
        if (s.direction === 'ambiguous') continue
        if (s.start_time < start || s.start_time >= end) continue

        // Find nearest slot time (linear scan is OK; slot counts are small per window).
        let best = Infinity
        for (const st of slotTimes) {
            const d = Math.abs(st - s.start_time)
            if (d < best) best = d
        }

        if (best <= MAX_SNAP_S) errors.push(best)
    }

    // If we couldn't snap most strums, treat as poor fit.
    if (errors.length === 0) return Infinity
    return mean(errors)
}

export function chooseSubdivision(
    mode: GridMode,
    start: number,
    end: number,
    rhythm: RhythmInfo | null,
    strums: StrumEvent[]
): Subdivision {
    if (!rhythm || !Array.isArray(rhythm.beat_times) || rhythm.beat_times.length < 2) return 1
    if (mode !== 'auto') return subdivisionFromMode(mode)

    const relevant = strums.filter((s) => s.direction !== 'ambiguous' && s.start_time >= start && s.start_time < end)
    if (relevant.length < 3) return 2

    const e2 = quantizeErrorForSubdivision(relevant, start, end, rhythm, 2)
    const e4 = quantizeErrorForSubdivision(relevant, start, end, rhythm, 4)

    // Prefer 16ths only when it meaningfully improves alignment.
    // 10ms threshold keeps things stable and avoids noisy over-quantization.
    if (Number.isFinite(e4) && e4 + 0.01 < e2) return 4
    return 2
}

export function quantizeStrumsToSlots(
    slots: GridSlot[],
    strums: StrumEvent[]
): Map<number, QuantizedStrum> {
    const out = new Map<number, QuantizedStrum>()
    if (slots.length === 0) return out

    for (const s of strums) {
        if (s.direction === 'ambiguous') continue

        // Find nearest slot in time
        let bestIndex = -1
        let bestDist = Infinity
        for (let i = 0; i < slots.length; i++) {
            const d = Math.abs(slots[i].time - s.start_time)
            if (d < bestDist) {
                bestDist = d
                bestIndex = i
            }
        }

        if (bestIndex === -1 || bestDist > MAX_SNAP_S) continue

        const existing = out.get(bestIndex)
        if (!existing || s.confidence > existing.confidence) {
            out.set(bestIndex, {
                time: slots[bestIndex].time,
                direction: s.direction,
                confidence: s.confidence,
            })
        }
    }

    return out
}

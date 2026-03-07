import { useMemo } from 'react'

import { cn } from '@/lib/cn'
import { formatChordName } from '@/lib/chord-colors'

type Fret = number | 'x'

interface ChordShape {
    // Low E -> High e
    frets: [Fret, Fret, Fret, Fret, Fret, Fret]
}

const CHORD_SHAPES: Record<string, ChordShape> = {
    // ── Major ──
    C: { frets: ['x', 3, 2, 0, 1, 0] },
    'C#': { frets: ['x', 4, 3, 1, 2, 1] },
    Db: { frets: ['x', 4, 3, 1, 2, 1] },
    D: { frets: ['x', 'x', 0, 2, 3, 2] },
    'D#': { frets: ['x', 6, 8, 8, 8, 6] },
    Eb: { frets: ['x', 6, 8, 8, 8, 6] },
    E: { frets: [0, 2, 2, 1, 0, 0] },
    F: { frets: [1, 3, 3, 2, 1, 1] },
    'F#': { frets: [2, 4, 4, 3, 2, 2] },
    Gb: { frets: [2, 4, 4, 3, 2, 2] },
    G: { frets: [3, 2, 0, 0, 0, 3] },
    'G#': { frets: [4, 6, 6, 5, 4, 4] },
    Ab: { frets: [4, 6, 6, 5, 4, 4] },
    A: { frets: ['x', 0, 2, 2, 2, 0] },
    'A#': { frets: [6, 8, 8, 7, 6, 6] },
    Bb: { frets: [6, 8, 8, 7, 6, 6] },
    B: { frets: ['x', 2, 4, 4, 4, 2] },

    // ── Minor ──
    Cm: { frets: ['x', 3, 5, 5, 4, 3] },
    'C#m': { frets: ['x', 4, 6, 6, 5, 4] },
    Dbm: { frets: ['x', 4, 6, 6, 5, 4] },
    Dm: { frets: ['x', 'x', 0, 2, 3, 1] },
    'D#m': { frets: ['x', 6, 8, 8, 7, 6] },
    Ebm: { frets: ['x', 6, 8, 8, 7, 6] },
    Em: { frets: [0, 2, 2, 0, 0, 0] },
    Fm: { frets: [1, 3, 3, 1, 1, 1] },
    'F#m': { frets: [2, 4, 4, 2, 2, 2] },
    Gbm: { frets: [2, 4, 4, 2, 2, 2] },
    Gm: { frets: [3, 5, 5, 3, 3, 3] },
    'G#m': { frets: [4, 6, 6, 4, 4, 4] },
    Abm: { frets: [4, 6, 6, 4, 4, 4] },
    Am: { frets: ['x', 0, 2, 2, 1, 0] },
    'A#m': { frets: [6, 8, 8, 6, 6, 6] },
    Bbm: { frets: [6, 8, 8, 6, 6, 6] },
    Bm: { frets: ['x', 2, 4, 4, 3, 2] },

    // ── Dominant 7th ──
    C7: { frets: ['x', 3, 2, 3, 1, 0] },
    'C#7': { frets: ['x', 4, 6, 4, 6, 4] },
    Db7: { frets: ['x', 4, 6, 4, 6, 4] },
    D7: { frets: ['x', 'x', 0, 2, 1, 2] },
    'D#7': { frets: ['x', 6, 8, 6, 8, 6] },
    Eb7: { frets: ['x', 6, 8, 6, 8, 6] },
    E7: { frets: [0, 2, 0, 1, 0, 0] },
    F7: { frets: [1, 3, 1, 2, 1, 1] },
    'F#7': { frets: [2, 4, 2, 3, 2, 2] },
    Gb7: { frets: [2, 4, 2, 3, 2, 2] },
    G7: { frets: [3, 2, 0, 0, 0, 1] },
    'G#7': { frets: [4, 6, 4, 5, 4, 4] },
    Ab7: { frets: [4, 6, 4, 5, 4, 4] },
    A7: { frets: ['x', 0, 2, 0, 2, 0] },
    'A#7': { frets: [6, 8, 6, 7, 6, 6] },
    Bb7: { frets: [6, 8, 6, 7, 6, 6] },
    B7: { frets: ['x', 2, 1, 2, 0, 2] },

    // ── Minor 7th ──
    Cm7: { frets: ['x', 3, 5, 3, 4, 3] },
    'C#m7': { frets: ['x', 4, 6, 4, 5, 4] },
    Dbm7: { frets: ['x', 4, 6, 4, 5, 4] },
    Dm7: { frets: ['x', 'x', 0, 2, 1, 1] },
    'D#m7': { frets: ['x', 6, 8, 6, 7, 6] },
    Ebm7: { frets: ['x', 6, 8, 6, 7, 6] },
    Em7: { frets: [0, 2, 2, 0, 3, 0] },
    Fm7: { frets: [1, 3, 1, 1, 1, 1] },
    'F#m7': { frets: [2, 4, 2, 2, 2, 2] },
    Gbm7: { frets: [2, 4, 2, 2, 2, 2] },
    Gm7: { frets: [3, 5, 3, 3, 3, 3] },
    'G#m7': { frets: [4, 6, 4, 4, 4, 4] },
    Abm7: { frets: [4, 6, 4, 4, 4, 4] },
    Am7: { frets: ['x', 0, 2, 0, 1, 0] },
    'A#m7': { frets: [6, 8, 6, 6, 6, 6] },
    Bbm7: { frets: [6, 8, 6, 6, 6, 6] },
    Bm7: { frets: ['x', 2, 4, 2, 3, 2] },

    // ── Major 7th ──
    Cmaj7: { frets: ['x', 3, 2, 0, 0, 0] },
    'C#maj7': { frets: ['x', 4, 3, 1, 1, 1] },
    Dbmaj7: { frets: ['x', 4, 3, 1, 1, 1] },
    Dmaj7: { frets: ['x', 'x', 0, 2, 2, 2] },
    'D#maj7': { frets: ['x', 6, 8, 7, 8, 6] },
    Ebmaj7: { frets: ['x', 6, 8, 7, 8, 6] },
    Emaj7: { frets: [0, 2, 1, 1, 0, 0] },
    Fmaj7: { frets: ['x', 'x', 3, 2, 1, 0] },
    'F#maj7': { frets: [2, 4, 3, 3, 2, 2] },
    Gbmaj7: { frets: [2, 4, 3, 3, 2, 2] },
    Gmaj7: { frets: [3, 2, 0, 0, 0, 2] },
    'G#maj7': { frets: [4, 6, 5, 5, 4, 4] },
    Abmaj7: { frets: [4, 6, 5, 5, 4, 4] },
    Amaj7: { frets: ['x', 0, 2, 1, 2, 0] },
    'A#maj7': { frets: [6, 8, 7, 7, 6, 6] },
    Bbmaj7: { frets: [6, 8, 7, 7, 6, 6] },
    Bmaj7: { frets: ['x', 2, 4, 3, 4, 2] },

    // ── Suspended ──
    Csus2: { frets: ['x', 3, 0, 0, 3, 3] },
    Csus4: { frets: ['x', 3, 3, 0, 1, 1] },
    Dsus2: { frets: ['x', 'x', 0, 2, 3, 0] },
    Dsus4: { frets: ['x', 'x', 0, 2, 3, 3] },
    Esus2: { frets: [0, 2, 4, 4, 0, 0] },
    Esus4: { frets: [0, 2, 2, 2, 0, 0] },
    Fsus2: { frets: ['x', 'x', 3, 0, 1, 1] },
    Fsus4: { frets: ['x', 'x', 3, 3, 1, 1] },
    Gsus2: { frets: [3, 0, 0, 0, 3, 3] },
    Gsus4: { frets: [3, 3, 0, 0, 1, 3] },
    Asus2: { frets: ['x', 0, 2, 2, 0, 0] },
    Asus4: { frets: ['x', 0, 2, 2, 3, 0] },
    Bsus2: { frets: ['x', 2, 4, 4, 2, 2] },
    Bsus4: { frets: ['x', 2, 4, 4, 5, 2] },

    // ── Diminished ──
    Cdim: { frets: ['x', 3, 4, 5, 4, 'x'] },
    Ddim: { frets: ['x', 5, 6, 7, 6, 'x'] },
    Edim: { frets: [0, 1, 2, 0, 'x', 'x'] },
    Fdim: { frets: ['x', 'x', 3, 1, 0, 1] },
    Gdim: { frets: ['x', 'x', 5, 3, 2, 3] },
    Adim: { frets: ['x', 0, 1, 2, 1, 'x'] },
    Bdim: { frets: ['x', 2, 3, 4, 3, 'x'] },

    // ── Augmented ──
    Caug: { frets: ['x', 3, 2, 1, 1, 0] },
    Daug: { frets: ['x', 'x', 0, 3, 3, 2] },
    Eaug: { frets: [0, 3, 2, 1, 1, 0] },
    Faug: { frets: ['x', 'x', 3, 2, 2, 1] },
    Gaug: { frets: [3, 2, 1, 0, 0, 3] },
    Aaug: { frets: ['x', 0, 3, 2, 2, 1] },
    Baug: { frets: ['x', 2, 1, 0, 0, 3] },
}

function normalizeChordName(raw: string): string {
    const trimmed = (raw || '').trim()
    if (!trimmed) return ''

    // Convert backend notation (e.g. "C:maj") to display notation (e.g. "C")
    const formatted = formatChordName(trimmed)

    // Strip slash bass notes: C/G -> C
    const noSlash = formatted.split('/')[0] ?? formatted

    // Remove parentheses/extra spacing: "Am(add9)" -> "Amadd9" (we likely won't have shapes anyway)
    const simplified = noSlash.replaceAll(' ', '').replaceAll('(', '').replaceAll(')', '')

    // Keep just the common display part for lookup.
    // Examples:
    //  - "Am" => "Am"
    //  - "A#m" => "A#m" (no shape provided, but we preserve)
    //  - "F#" => "F#"
    //  - "F#m" => "F#m"
    return simplified
}

function getShape(chordName: string): ChordShape | null {
    const key = normalizeChordName(chordName)
    return (key && CHORD_SHAPES[key]) || null
}

function computeBaseFret(frets: ChordShape['frets']): number {
    const positives = frets.filter((f) => typeof f === 'number' && f > 0) as number[]
    if (positives.length === 0) return 1
    const min = Math.min(...positives)
    const max = Math.max(...positives)
    // If the shape spans more than 5 frets, anchor at min.
    if (max - min >= 5) return min
    // If there are open strings, prefer showing from fret 1.
    if (frets.some((f) => f === 0)) return 1
    return min
}

export function ChordDiagram({ chord }: { chord: string }) {
    const shape = getShape(chord)

    if (!shape) {
        return (
            <div className="rounded-lg border border-charcoal-700 bg-charcoal-900/40 p-3">
                <div className="text-sm font-semibold text-smoke-100">{formatChordName(chord)}</div>
                <div className="mt-1 text-xs text-smoke-500">No diagram yet</div>
            </div>
        )
    }

    const baseFret = computeBaseFret(shape.frets)

    // Grid: 6 strings (vertical) x 5 frets (horizontal)
    const strings = ['E', 'A', 'D', 'G', 'B', 'e'] as const

    return (
        <div className="rounded-lg border border-charcoal-700 bg-charcoal-900/40 p-3">
            <div className="flex items-baseline justify-between gap-2">
                <div className="text-sm font-semibold text-smoke-100">{formatChordName(chord)}</div>
                {baseFret > 1 && <div className="text-xs text-smoke-500">fret {baseFret}</div>}
            </div>

            {/* Open/mute markers */}
            <div className="mt-2 grid grid-cols-6 gap-1 text-[10px] text-smoke-500 font-mono">
                {shape.frets.map((f, i) => (
                    <div key={i} className="text-center">
                        {f === 'x' ? 'x' : f === 0 ? 'o' : ''}
                    </div>
                ))}
            </div>

            <div className="mt-1 relative">
                <div className="grid grid-cols-6 gap-1">
                    {strings.map((_, colIdx) => (
                        <div key={colIdx} className="relative">
                            {/* String line */}
                            <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-px bg-charcoal-600" />

                            {/* Fret lines */}
                            <div className="flex flex-col justify-between h-20">
                                {Array.from({ length: 6 }).map((__, rowIdx) => (
                                    <div
                                        // 6 lines for 5 fret spaces
                                        key={rowIdx}
                                        className={cn('w-full h-px', rowIdx === 0 && baseFret === 1 ? 'bg-smoke-500/50' : 'bg-charcoal-600')}
                                    />
                                ))}
                            </div>
                        </div>
                    ))}
                </div>

                {/* Dots */}
                <div className="absolute inset-0 grid grid-cols-6 gap-1">
                    {shape.frets.map((f, stringIdx) => {
                        if (typeof f !== 'number' || f <= 0) return <div key={stringIdx} />
                        const row = f - baseFret + 1
                        // row 1..5 maps to fret spaces
                        if (row < 1 || row > 5) return <div key={stringIdx} />

                        return (
                            <div key={stringIdx} className="relative">
                                <div
                                    className="absolute left-1/2 -translate-x-1/2 size-3 rounded-full bg-flame-400 shadow-[0_0_10px_rgba(250,204,21,0.25)]"
                                    style={{ top: `${(row - 0.5) * 20}%` }}
                                />
                            </div>
                        )
                    })}
                </div>
            </div>

            <div className="mt-2 grid grid-cols-6 gap-1 text-[10px] text-smoke-500 font-mono">
                {strings.map((s) => (
                    <div key={s} className="text-center select-none">
                        {s}
                    </div>
                ))}
            </div>
        </div>
    )
}

export function ChordMap({
    chords,
    showHeader = true,
    className,
}: {
    chords: string[]
    showHeader?: boolean
    className?: string
}) {
    const unique = useMemo(() => {
        const seen = new Set<string>()
        const out: string[] = []
        for (const c of chords) {
            const name = (c || '').trim()
            if (!name) continue
            const key = normalizeChordName(name)
            if (!key || key === 'N') continue
            if (seen.has(key)) continue
            seen.add(key)
            out.push(name)
        }
        return out
    }, [chords])

    if (unique.length === 0) return null

    return (
        <aside className={cn('flex flex-col gap-3 min-h-0 h-full', className)} data-testid="chord-map">
            {showHeader && (
                <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-smoke-200">Chord Map</h3>
                    <span className="text-xs text-smoke-500">shapes</span>
                </div>
            )}

            <div className="grid grid-cols-2 auto-rows-max content-start items-start gap-2 overflow-y-auto flex-1 min-h-0 pr-1">
                {unique.map((ch) => (
                    <ChordDiagram key={normalizeChordName(ch)} chord={ch} />
                ))}
            </div>
        </aside>
    )
}

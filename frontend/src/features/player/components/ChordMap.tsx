import { useMemo } from 'react'

import { cn } from '@/lib/cn'
import { formatChordName } from '@/lib/chord-colors'
import { getPrimaryVoicing, normalizeChordName } from '../lib/chord-shapes'
import { adaptVoicingToBass, noteToPitchClass, splitSlashBass } from '../lib/chord-voicings'
import type { SectionStrumPattern, StrumSymbol } from '../lib/strum-pattern'
import { StrumPatternCard } from './StrumPatternCard'
import { Fretboard } from './Fretboard'


interface ChordDiagramProps {
    chord: string
}

/**
 * Renders the built-in (primary) fingering diagram for a chord. Used by the always-visible
 * chord map and current-chord panel; richer alternate voicings are loaded on demand in the
 * voicing browser popover.
 *
 * Slash chords (E/B) render the TRUE inversion when reachable: the root shape
 * re-bassed so the slash note sounds lowest, with a hint naming the bass.
 */
export function ChordDiagram({ chord }: ChordDiagramProps) {
    const { root, bass } = splitSlashBass(formatChordName(chord))
    const rootVoicing = getPrimaryVoicing(root)
    if (!rootVoicing) return null

    const bassPc = bass != null ? noteToPitchClass(bass) : null
    const inversion = bassPc != null ? adaptVoicingToBass(rootVoicing, bassPc) : null
    const voicing = inversion ?? rootVoicing
    const label = bass ? `${root}/${bass}` : root

    return (
        <div className="rounded-lg border border-charcoal-700 bg-charcoal-900/40 p-3" aria-label={`${label} chord diagram`}>
            <div className="mb-2 text-sm font-semibold text-smoke-100" dir="ltr" style={{ unicodeBidi: 'isolate' }}>
                {label}
            </div>
            <Fretboard voicing={voicing} />
            {bass && (
                <div className="mt-1.5 text-[11px] text-smoke-400" dir="ltr">
                    {inversion ? (
                        <><span className="font-semibold text-smoke-200">{bass}</span> in the bass</>
                    ) : (
                        <>{root} shape · play <span className="font-semibold text-smoke-200">{bass}</span> in the bass</>
                    )}
                </div>
            )}
        </div>
    )
}

interface TutorialLink {
    url: string
    title: string
}

interface ChordMapProps {
    chords: string[]
    representativePattern?: StrumSymbol[]
    sectionPatterns?: SectionStrumPattern[]
    bpm?: number
    strumNotes?: string | null
    tutorialUrl?: string | null
    tutorialLinks?: TutorialLink[]
    strumLoading?: boolean
    showHeader?: boolean
    songKey?: string | null
    className?: string
    onOpenTutorial?: () => void
}

/**
 * Displays a grid of chord diagrams with optional strum pattern and tutorial links.
 */
export function ChordMap({
    chords,
    sectionPatterns,
    bpm,
    strumNotes,
    tutorialUrl,
    tutorialLinks,
    strumLoading,
    showHeader = true,
    songKey,
    className,
    onOpenTutorial,
}: ChordMapProps) {
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
                    <div className="flex items-center gap-2">
                        <h3 className="text-sm font-semibold text-smoke-200">Chord Map</h3>
                        {songKey && (
                            <span
                                className="bg-emerald-400/20 text-emerald-400 text-xs px-1.5 py-0.5 rounded"
                                data-testid="chord-key-badge"
                            >
                                Key: {songKey}
                            </span>
                        )}
                    </div>
                    <span className="text-xs text-smoke-500">shapes</span>
                </div>
            )}

            <div className="shrink min-h-0 overflow-y-auto max-h-[50%]">
                <StrumPatternCard
                    sectionPatterns={sectionPatterns ?? []}
                    bpm={bpm ?? 120}
                    strumNotes={strumNotes}
                    tutorialUrl={tutorialUrl}
                    tutorialLinks={tutorialLinks}
                    loading={strumLoading}
                    onOpenTutorial={onOpenTutorial}
                />
            </div>

            <div className="grid grid-cols-2 auto-rows-max content-start items-start gap-2 overflow-y-auto flex-1 min-h-0 pr-1">
                {unique.map((ch) => (
                    <ChordDiagram key={normalizeChordName(ch)} chord={ch} />
                ))}
            </div>
        </aside>
    )
}

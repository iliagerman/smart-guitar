import { useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { X } from 'lucide-react'

import { cn } from '@/lib/cn'
import { ChordMap } from './ChordMap'
import type { SectionStrumPattern, StrumSymbol } from '../lib/strum-pattern'

function ChordMapIcon({ size = 48, className }: { size?: number; className?: string }) {
    return (
        <svg width={size} height={size} viewBox="0 0 48 48" fill="none" className={cn('shrink-0', className)}>
            {/* Grid / chord diagram */}
            {/* Frets (horizontal) */}
            <line x1="8" y1="8" x2="40" y2="8" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
            <line x1="8" y1="16" x2="40" y2="16" stroke="currentColor" strokeWidth="1.5" />
            <line x1="8" y1="24" x2="40" y2="24" stroke="currentColor" strokeWidth="1.5" />
            <line x1="8" y1="32" x2="40" y2="32" stroke="currentColor" strokeWidth="1.5" />
            <line x1="8" y1="40" x2="40" y2="40" stroke="currentColor" strokeWidth="1.5" />
            {/* Strings (vertical) */}
            <line x1="8" y1="8" x2="8" y2="40" stroke="currentColor" strokeWidth="1.5" />
            <line x1="14.4" y1="8" x2="14.4" y2="40" stroke="currentColor" strokeWidth="1.5" />
            <line x1="20.8" y1="8" x2="20.8" y2="40" stroke="currentColor" strokeWidth="1.5" />
            <line x1="27.2" y1="8" x2="27.2" y2="40" stroke="currentColor" strokeWidth="1.5" />
            <line x1="33.6" y1="8" x2="33.6" y2="40" stroke="currentColor" strokeWidth="1.5" />
            <line x1="40" y1="8" x2="40" y2="40" stroke="currentColor" strokeWidth="1.5" />
            {/* Finger dots */}
            <circle cx="14.4" cy="12" r="3" fill="currentColor" />
            <circle cx="27.2" cy="20" r="3" fill="currentColor" />
            <circle cx="33.6" cy="20" r="3" fill="currentColor" />
            <circle cx="20.8" cy="28" r="3" fill="currentColor" />
        </svg>
    )
}

interface ChordMapDialogProps {
    chords: string[]
    representativePattern?: StrumSymbol[]
    sectionPatterns?: SectionStrumPattern[]
    bpm?: number
    strumNotes?: string | null
    tutorialUrl?: string | null
    tutorialLinks?: { url: string; title: string }[]
    strumLoading?: boolean
    className?: string
    iconOnly?: boolean
    onOpenTutorial?: () => void
}

export function ChordMapDialog({ chords, representativePattern, sectionPatterns, bpm, strumNotes, tutorialUrl, tutorialLinks, strumLoading, className, iconOnly = false, onOpenTutorial }: ChordMapDialogProps) {
    const [open, setOpen] = useState(false)

    // ChordMap itself will return null when there are no usable chords.
    // We still need a cheap guard so we don't show a dead trigger.
    const hasAny = chords.some((c) => (c || '').trim().length > 0)
    if (!hasAny) return null

    const handleOpenTutorial = () => {
        setOpen(false)
        onOpenTutorial?.()
    }

    return (
        <Dialog.Root open={open} onOpenChange={setOpen}>
            <Dialog.Trigger asChild>
                <button
                    type="button"
                    className={cn(
                        iconOnly
                            ? 'inline-flex items-center justify-center rounded-lg w-16 h-16'
                            : 'inline-flex items-center justify-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium',
                        'bg-charcoal-700 border border-charcoal-600 text-flame-400/70',
                        'hover:border-flame-400/30 hover:text-flame-400 transition-colors',
                        'focus:outline-none focus:ring-2 focus:ring-flame-400/40 focus:ring-offset-1 focus:ring-offset-charcoal-800',
                        className,
                    )}
                    aria-label={iconOnly ? 'Open chord map' : undefined}
                >
                    {iconOnly ? (
                        <ChordMapIcon size={40} />
                    ) : (
                        'Chord Map'
                    )}
                </button>
            </Dialog.Trigger>

            <Dialog.Portal>
                <Dialog.Overlay className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50" />
                <Dialog.Content
                    className={cn(
                        'fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50',
                        'w-[calc(100%-2rem)] max-w-md',
                        'max-h-[80vh] rounded-2xl bg-charcoal-900 border border-charcoal-700 shadow-2xl',
                        'flex flex-col overflow-hidden',
                    )}
                >
                    <div className="flex items-center justify-between px-4 py-3 border-b border-charcoal-800">
                        <Dialog.Title className="text-sm font-semibold text-smoke-100">Chord Map</Dialog.Title>
                        <Dialog.Close
                            className="text-smoke-500 hover:text-smoke-200 transition-colors"
                            aria-label="Close chord map"
                        >
                            <X size={18} />
                        </Dialog.Close>
                    </div>

                    <div className="flex-1 min-h-0 overflow-y-auto p-4">
                        <ChordMap chords={chords} representativePattern={representativePattern} sectionPatterns={sectionPatterns} bpm={bpm} strumNotes={strumNotes} tutorialUrl={tutorialUrl} tutorialLinks={tutorialLinks} strumLoading={strumLoading} showHeader={false} onOpenTutorial={handleOpenTutorial} />
                    </div>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    )
}

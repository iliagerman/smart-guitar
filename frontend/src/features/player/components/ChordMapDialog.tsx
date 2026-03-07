import * as Dialog from '@radix-ui/react-dialog'
import { Shapes, X } from 'lucide-react'

import { cn } from '@/lib/cn'
import { ChordMap } from './ChordMap'

interface ChordMapDialogProps {
    chords: string[]
    className?: string
    iconOnly?: boolean
}

export function ChordMapDialog({ chords, className, iconOnly = false }: ChordMapDialogProps) {
    // ChordMap itself will return null when there are no usable chords.
    // We still need a cheap guard so we don't show a dead trigger.
    const hasAny = chords.some((c) => (c || '').trim().length > 0)
    if (!hasAny) return null

    return (
        <Dialog.Root>
            <Dialog.Trigger asChild>
                <button
                    type="button"
                    className={cn(
                        'inline-flex items-center justify-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium',
                        'bg-charcoal-700 border border-charcoal-600 text-smoke-100',
                        'hover:border-flame-400/30 transition-colors',
                        'focus:outline-none focus:ring-2 focus:ring-flame-400/40 focus:ring-offset-1 focus:ring-offset-charcoal-800',
                        iconOnly && 'px-2',
                        className,
                    )}
                    aria-label={iconOnly ? 'Open chord map' : undefined}
                >
                    {iconOnly ? (
                        <Shapes size={18} className="text-smoke-200" />
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

                    <div className="flex-1 min-h-0 p-4">
                        <ChordMap chords={chords} showHeader={false} className="h-full" />
                    </div>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    )
}

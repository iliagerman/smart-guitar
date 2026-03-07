import * as Select from '@radix-ui/react-select'
import { Check, ChevronDown } from 'lucide-react'

import { cn } from '@/lib/cn'
import { usePlaybackStore } from '@/stores/playback.store'

const SPEED_OPTIONS = [0.5, 0.75, 1, 1.25, 1.5] as const

function formatSpeed(rate: number) {
    // Avoid 1.0x looking like 1x. Keep a consistent UI.
    return `${Number.isInteger(rate) ? rate : rate}x`
}

export function PlaybackSpeedSelector() {
    const playbackRate = usePlaybackStore((s) => s.playbackRate)
    const setPlaybackRate = usePlaybackStore((s) => s.setPlaybackRate)

    const value = String(playbackRate)

    return (
        <div data-testid="playback-speed-selector">
            <Select.Root
                value={value}
                onValueChange={(val) => {
                    const parsed = Number(val)
                    setPlaybackRate(parsed)
                }}
            >
                <Select.Trigger
                    className={cn(
                        'inline-flex items-center justify-between gap-1.5 rounded-lg px-2 py-1 text-xs font-medium',
                        'bg-charcoal-700 border border-charcoal-600 text-smoke-100',
                        'hover:border-flame-400/30 transition-colors',
                        'focus:outline-none focus:ring-2 focus:ring-flame-400/40 focus:ring-offset-1 focus:ring-offset-charcoal-800',
                        'w-auto'
                    )}
                    aria-label="Playback speed"
                >
                    <Select.Value>{formatSpeed(playbackRate)}</Select.Value>
                    <Select.Icon>
                        <ChevronDown size={12} className="text-smoke-400" />
                    </Select.Icon>
                </Select.Trigger>

                <Select.Portal>
                    <Select.Content
                        className={cn(
                            'bg-charcoal-800 border border-charcoal-600 rounded-lg shadow-xl',
                            'w-(--radix-select-trigger-width) max-h-(--radix-select-content-available-height)',
                            'overflow-hidden z-50',
                            'animate-in fade-in-0 zoom-in-95'
                        )}
                        position="popper"
                        sideOffset={4}
                    >
                        <Select.Viewport className="p-1 max-h-(--radix-select-content-available-height) overflow-y-auto">
                            {SPEED_OPTIONS.map((rate) => {
                                const isActive = playbackRate === rate

                                return (
                                    <Select.Item
                                        key={rate}
                                        value={String(rate)}
                                        className={cn(
                                            'relative flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium',
                                            'cursor-pointer outline-none transition-colors',
                                            'data-highlighted:bg-flame-400/10 data-highlighted:text-flame-300',
                                            isActive ? 'bg-flame-400/20 text-flame-400' : 'text-smoke-300'
                                        )}
                                        data-testid={`playback-speed-${rate}`}
                                    >
                                        <Select.ItemText>{formatSpeed(rate)}</Select.ItemText>
                                        {isActive && (
                                            <Select.ItemIndicator className="ml-auto">
                                                <Check size={14} className="text-flame-400" />
                                            </Select.ItemIndicator>
                                        )}
                                    </Select.Item>
                                )
                            })}
                        </Select.Viewport>
                    </Select.Content>
                </Select.Portal>
            </Select.Root>
        </div>
    )
}

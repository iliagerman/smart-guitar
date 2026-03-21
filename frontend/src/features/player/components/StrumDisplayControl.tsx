import { ArrowDownUp } from 'lucide-react'

import { cn } from '@/lib/cn'
import { usePlayerPrefsStore } from '@/stores/player-prefs.store'

export function StrumDisplayControl({ className }: { className?: string }) {
    const showStrums = usePlayerPrefsStore((s) => s.showStrums)
    const toggleShowStrums = usePlayerPrefsStore((s) => s.toggleShowStrums)

    return (
        <button
            type="button"
            className={cn(
                'inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-sm font-medium transition-colors',
                showStrums
                    ? 'border-flame-400/60 bg-flame-400/15 text-flame-200 hover:border-flame-300 hover:bg-flame-400/25'
                    : 'border-charcoal-600 bg-charcoal-700 text-smoke-100 hover:border-flame-400/50 hover:bg-charcoal-800/80 hover:text-smoke-50',
                className,
            )}
            onClick={toggleShowStrums}
            aria-pressed={showStrums}
            aria-label={showStrums ? 'Hide strumming arrows and beat counts' : 'Show strumming arrows and beat counts'}
            title={showStrums ? 'Hide strumming arrows and beat counts' : 'Show strumming arrows and beat counts'}
            data-testid="strum-display-control"
        >
            <ArrowDownUp size={18} />
        </button>
    )
}
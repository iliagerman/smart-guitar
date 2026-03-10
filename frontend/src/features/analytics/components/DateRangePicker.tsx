import { useAnalyticsFilterStore } from '@/stores/analytics-filter.store'
import { cn } from '@/lib/cn'

const presets = [
    { key: '7d', label: '7D' },
    { key: '30d', label: '30D' },
    { key: '90d', label: '90D' },
] as const

export function DateRangePicker() {
    const preset = useAnalyticsFilterStore((s) => s.preset)
    const startDate = useAnalyticsFilterStore((s) => s.startDate)
    const endDate = useAnalyticsFilterStore((s) => s.endDate)
    const setPreset = useAnalyticsFilterStore((s) => s.setPreset)
    const setCustomRange = useAnalyticsFilterStore((s) => s.setCustomRange)

    return (
        <div className="flex flex-col gap-3 rounded-2xl border border-charcoal-800 bg-charcoal-900/70 p-3">
            <div className="flex flex-wrap gap-2">
                {presets.map(({ key, label }) => (
                    <button
                        key={key}
                        type="button"
                        onClick={() => setPreset(key)}
                        className={cn(
                            'rounded-lg border px-3 py-1.5 text-sm font-semibold transition-colors',
                            preset === key
                                ? 'border-flame-400/40 bg-flame-400/15 text-smoke-100'
                                : 'border-charcoal-700 text-smoke-300 hover:border-flame-400/20 hover:bg-flame-400/10 hover:text-smoke-100',
                        )}
                    >
                        {label}
                    </button>
                ))}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
                <label className="flex flex-col gap-1 text-sm text-smoke-300">
                    <span>From</span>
                    <input
                        type="date"
                        value={startDate}
                        onChange={(e) => setCustomRange(e.target.value, endDate)}
                        className="rounded-lg border border-charcoal-700 bg-charcoal-950 px-3 py-2 text-sm text-smoke-100 outline-none transition-colors focus:border-flame-400/40"
                    />
                </label>
                <label className="flex flex-col gap-1 text-sm text-smoke-300">
                    <span>To</span>
                    <input
                        type="date"
                        value={endDate}
                        onChange={(e) => setCustomRange(startDate, e.target.value)}
                        className="rounded-lg border border-charcoal-700 bg-charcoal-950 px-3 py-2 text-sm text-smoke-100 outline-none transition-colors focus:border-flame-400/40"
                    />
                </label>
            </div>
        </div>
    )
}

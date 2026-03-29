import type { AnalyticsOverview } from '@/types/analytics'

const cards = [
    { key: 'total_events', label: 'Total Events' },
    { key: 'unique_users', label: 'Active Users' },
    { key: 'total_sessions', label: 'Sessions' },
    { key: 'song_play_count', label: 'Song Plays' },
] as const

interface OverviewCardsProps {
    overview: AnalyticsOverview
}

export function OverviewCards({ overview }: OverviewCardsProps) {
    return (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {cards.map(({ key, label }) => (
                <div key={key} className="rounded-2xl border border-charcoal-800 bg-charcoal-900/70 p-4">
                    <p className="text-sm text-smoke-400">{label}</p>
                    <p className="mt-2 text-3xl font-bold text-smoke-100">{overview[key].toLocaleString()}</p>
                </div>
            ))}
        </div>
    )
}

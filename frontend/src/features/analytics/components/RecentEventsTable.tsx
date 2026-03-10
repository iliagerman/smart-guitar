import type { RecentEvent } from '@/types/analytics'
import { EmptyState } from '@/components/shared/EmptyState'

function formatDateTime(value: string) {
    return new Intl.DateTimeFormat(undefined, {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
    }).format(new Date(value))
}

export function RecentEventsTable({ events }: { events: RecentEvent[] }) {
    return (
        <section className="rounded-2xl border border-charcoal-800 bg-charcoal-900/70 p-4">
            <div className="mb-4">
                <h2 className="text-lg font-semibold text-smoke-100">Recent events</h2>
                <p className="text-sm text-smoke-400">Latest analytics timeline for quick sanity checks.</p>
            </div>
            {events.length === 0 ? (
                <EmptyState title="No recent events" description="Once analytics are recorded, the latest events will appear here." className="py-10" />
            ) : (
                <div className="overflow-x-auto">
                    <table className="min-w-full text-sm">
                        <thead>
                            <tr className="border-b border-charcoal-800 text-left text-smoke-400">
                                <th className="px-3 py-2 font-medium">When</th>
                                <th className="px-3 py-2 font-medium">Event</th>
                                <th className="px-3 py-2 font-medium">User</th>
                                <th className="px-3 py-2 font-medium">Song</th>
                            </tr>
                        </thead>
                        <tbody>
                            {events.map((event) => (
                                <tr key={event.id} className="border-b border-charcoal-900/80 align-top">
                                    <td className="px-3 py-3 text-smoke-300">{formatDateTime(event.created_at)}</td>
                                    <td className="px-3 py-3 text-smoke-200">
                                        <div className="font-medium">{event.event_type}</div>
                                        <div className="text-xs text-smoke-500">{event.event_category} · {event.event_source}</div>
                                    </td>
                                    <td className="px-3 py-3 text-smoke-300">{event.user_email ?? '—'}</td>
                                    <td className="px-3 py-3 text-smoke-300">{event.song_title ?? '—'}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </section>
    )
}

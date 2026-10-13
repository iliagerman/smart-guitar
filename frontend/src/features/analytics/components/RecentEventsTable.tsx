import type { RecentEvent } from '@/types/analytics'
import { EmptyState } from '@/components/shared/EmptyState'
import { describeEventClient, describeEventDetails } from '../lib/event-details'

const dateTimeFormatter = new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
})

function formatDateTime(value: string) {
    return dateTimeFormatter.format(new Date(value))
}

interface RecentEventsTableProps {
    events: RecentEvent[]
}

export function RecentEventsTable({ events }: RecentEventsTableProps) {
    return (
        <section className="rounded-2xl border border-charcoal-800 bg-charcoal-900/70 p-4" data-testid="recent-events-table">
            <div className="mb-4">
                <h2 className="text-lg font-semibold text-smoke-100">Recent events</h2>
                <p className="text-sm text-smoke-400">
                    Filter by user to see everything they did, on which device, and how the player was set up.
                </p>
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
                                <th className="px-3 py-2 font-medium">Device</th>
                                <th className="px-3 py-2 font-medium">Details</th>
                            </tr>
                        </thead>
                        <tbody>
                            {events.map((event) => {
                                const client = describeEventClient(event.properties)
                                const details = describeEventDetails(event.properties)
                                return (
                                    <tr key={event.id} className="border-b border-charcoal-900/80 align-top" data-testid="recent-event-row">
                                        <td className="whitespace-nowrap p-3 text-smoke-300">{formatDateTime(event.created_at)}</td>
                                        <td className="p-3 text-smoke-200">
                                            <div className="font-medium">{event.event_type}</div>
                                            <div className="text-xs text-smoke-500">{event.event_category} · {event.event_source}</div>
                                        </td>
                                        <td className="p-3 text-smoke-300">{event.user_email ?? '—'}</td>
                                        <td className="p-3 text-smoke-300">{event.song_title ?? '—'}</td>
                                        <td className="p-3 text-smoke-300">
                                            {client ? (
                                                <>
                                                    <div className="whitespace-nowrap">{client.summary}</div>
                                                    <div className="text-xs text-smoke-500">{client.detail}</div>
                                                </>
                                            ) : '—'}
                                        </td>
                                        <td className="p-3 text-smoke-300">
                                            {details.length === 0 ? '—' : (
                                                <ul className="flex max-w-xl flex-wrap gap-x-3 gap-y-1 font-mono text-xs">
                                                    {details.map(({ key, value }) => (
                                                        <li key={key} className="break-all">
                                                            <span className="text-smoke-500">{key}</span> {value}
                                                        </li>
                                                    ))}
                                                </ul>
                                            )}
                                        </td>
                                    </tr>
                                )
                            })}
                        </tbody>
                    </table>
                </div>
            )}
        </section>
    )
}

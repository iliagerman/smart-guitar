import type { UserActivity } from '@/types/analytics'
import { EmptyState } from '@/components/shared/EmptyState'

function formatDateTime(value: string) {
    return new Intl.DateTimeFormat(undefined, {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
    }).format(new Date(value))
}

export function UserActivityTable({ users }: { users: UserActivity[] }) {
    return (
        <section className="rounded-2xl border border-charcoal-800 bg-charcoal-900/70 p-4">
            <div className="mb-4">
                <h2 className="text-lg font-semibold text-smoke-100">User activity</h2>
                <p className="text-sm text-smoke-400">Who’s active and when they last showed up.</p>
            </div>
            {users.length === 0 ? (
                <EmptyState title="No user activity yet" description="Once events are recorded with user emails, they’ll appear here." className="py-10" />
            ) : (
                <div className="overflow-x-auto">
                    <table className="min-w-full text-sm">
                        <thead>
                            <tr className="border-b border-charcoal-800 text-left text-smoke-400">
                                <th className="px-3 py-2 font-medium">User</th>
                                <th className="px-3 py-2 font-medium">Events</th>
                                <th className="px-3 py-2 font-medium">Last seen</th>
                            </tr>
                        </thead>
                        <tbody>
                            {users.map((user) => (
                                <tr key={user.user_email} className="border-b border-charcoal-900/80">
                                    <td className="px-3 py-3 text-smoke-200">{user.user_email}</td>
                                    <td className="px-3 py-3 text-smoke-300">{user.event_count.toLocaleString()}</td>
                                    <td className="px-3 py-3 text-smoke-300">{formatDateTime(user.last_seen_at)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </section>
    )
}

import { useMemo } from 'react'
// recharts is heavy, but its only consumer (AnalyticsDashboardPage) is route-level
// lazy-loaded in src/router/index.tsx, so recharts is already code-split out of the
// main bundle and only fetched when the analytics route is visited.
// oxlint-disable-next-line react-doctor/prefer-dynamic-import
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { EventTrend } from '@/types/analytics'
import { EmptyState } from '@/components/shared/EmptyState'

const bucketLabelFormat = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' })

function formatBucketLabel(value: string) {
    return bucketLabelFormat.format(new Date(value))
}

interface LoginChartProps {
    trends: EventTrend[]
}

export function LoginChart({ trends }: LoginChartProps) {
    const loginTrend = trends.find((trend) => trend.event_type === 'login')
    const data = useMemo(
        () =>
            (loginTrend?.buckets ?? []).map((bucket) => ({
                label: formatBucketLabel(bucket.bucket_start),
                count: bucket.count,
            })),
        [loginTrend],
    )

    return (
        <section className="rounded-2xl border border-charcoal-800 bg-charcoal-900/70 p-4">
            <div className="mb-4">
                <h2 className="text-lg font-semibold text-smoke-100">Logins over time</h2>
                <p className="text-sm text-smoke-400">Successful login events within the selected range.</p>
            </div>
            {data.length === 0 ? (
                <EmptyState title="No login events yet" description="Once logins are recorded, they’ll show up here." className="py-12" />
            ) : (
                <div className="h-72">
                    <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={data}>
                            <CartesianGrid stroke="#2f2f2f" vertical={false} />
                            <XAxis dataKey="label" stroke="#a4a4a4" tickLine={false} axisLine={false} />
                            <YAxis stroke="#a4a4a4" tickLine={false} axisLine={false} allowDecimals={false} />
                            <Tooltip
                                contentStyle={{ backgroundColor: '#111111', border: '1px solid #2f2f2f', borderRadius: 16 }}
                                cursor={{ fill: 'rgba(255,106,61,0.08)' }}
                            />
                            <Bar dataKey="count" fill="#ff6a3d" radius={[10, 10, 0, 0]} />
                        </BarChart>
                    </ResponsiveContainer>
                </div>
            )}
        </section>
    )
}

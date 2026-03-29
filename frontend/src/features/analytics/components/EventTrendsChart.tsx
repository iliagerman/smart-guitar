import { Area, AreaChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { EventTrend } from '@/types/analytics'
import { EmptyState } from '@/components/shared/EmptyState'

const colors = ['#ff6a3d', '#f59e0b', '#fb7185', '#f8fafc', '#f97316']

function formatBucketLabel(value: string) {
    return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date(value))
}

function buildTrendData(trends: EventTrend[]) {
    const map = new Map<string, Record<string, number | string>>()
    trends.forEach((trend) => {
        trend.buckets.forEach((bucket) => {
            const key = bucket.bucket_start
            const row = map.get(key) ?? { label: formatBucketLabel(bucket.bucket_start), bucket_start: key }
            row[trend.event_type] = bucket.count
            map.set(key, row)
        })
    })
    return Array.from(map.values()).sort((a, b) => String(a.bucket_start).localeCompare(String(b.bucket_start)))
}

interface EventTrendsChartProps {
    trends: EventTrend[]
}

export function EventTrendsChart({ trends }: EventTrendsChartProps) {
    const eventTypes = trends.map((trend) => trend.event_type)
    const data = buildTrendData(trends)

    return (
        <section className="rounded-2xl border border-charcoal-800 bg-charcoal-900/70 p-4">
            <div className="mb-4">
                <h2 className="text-lg font-semibold text-smoke-100">Event mix</h2>
                <p className="text-sm text-smoke-400">Stacked event activity across the selected window.</p>
            </div>
            {data.length === 0 ? (
                <EmptyState title="No event trends yet" description="Once events are flowing, the trend chart will appear here." className="py-12" />
            ) : (
                <div className="h-72">
                    <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={data}>
                            <CartesianGrid stroke="#2f2f2f" vertical={false} />
                            <XAxis dataKey="label" stroke="#a4a4a4" tickLine={false} axisLine={false} />
                            <YAxis stroke="#a4a4a4" tickLine={false} axisLine={false} allowDecimals={false} />
                            <Tooltip contentStyle={{ backgroundColor: '#111111', border: '1px solid #2f2f2f', borderRadius: 16 }} />
                            <Legend />
                            {eventTypes.map((eventType, index) => (
                                <Area
                                    key={eventType}
                                    type="monotone"
                                    dataKey={eventType}
                                    stackId="events"
                                    stroke={colors[index % colors.length]}
                                    fill={colors[index % colors.length]}
                                    fillOpacity={eventType === 'login' ? 0.35 : 0.18}
                                />
                            ))}
                        </AreaChart>
                    </ResponsiveContainer>
                </div>
            )}
        </section>
    )
}

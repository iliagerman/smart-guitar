import { AlertTriangle } from 'lucide-react'
import { PageBackground } from '@/components/shared/PageBackground'
import { PageContainer } from '@/components/shared/PageContainer'
import { EmptyState } from '@/components/shared/EmptyState'
import { Skeleton } from '@/components/shared/Skeleton'
import { DashboardHeader } from '../components/DashboardHeader'
import { OverviewCards } from '../components/OverviewCards'
import { LoginChart } from '../components/LoginChart'
import { EventTrendsChart } from '../components/EventTrendsChart'
import { SongRankingsTable } from '../components/SongRankingsTable'
import { UserActivityTable } from '../components/UserActivityTable'
import { RecentEventsTable } from '../components/RecentEventsTable'
import { useAnalyticsDashboard } from '../hooks/use-analytics-dashboard'
import { useAnalyticsUserEmails } from '../hooks/use-analytics-user-emails'

export function AnalyticsDashboardPage() {
    const { data, isLoading, isError, error } = useAnalyticsDashboard()
    const { data: emails = [] } = useAnalyticsUserEmails()

    return (
        <div className="relative min-h-full flex flex-col" data-testid="analytics-dashboard-page">
            <PageBackground />
            <DashboardHeader emails={emails} />
            <PageContainer className="max-w-7xl space-y-6">
                {isLoading ? (
                    <>
                        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                            {Array.from({ length: 4 }).map((_, index) => (
                                <Skeleton key={index} className="h-28 rounded-2xl" />
                            ))}
                        </div>
                        <div className="grid gap-6 xl:grid-cols-2">
                            <Skeleton className="h-96 rounded-2xl" />
                            <Skeleton className="h-96 rounded-2xl" />
                        </div>
                        <Skeleton className="h-80 rounded-2xl" />
                        <Skeleton className="h-80 rounded-2xl" />
                        <Skeleton className="h-96 rounded-2xl" />
                    </>
                ) : isError || !data ? (
                    <div className="rounded-2xl border border-rose-500/20 bg-rose-500/5">
                        <EmptyState
                            icon={<AlertTriangle size={28} />}
                            title="Analytics dashboard unavailable"
                            description={error instanceof Error ? error.message : 'Could not load analytics data.'}
                            className="py-12"
                        />
                    </div>
                ) : (
                    <>
                        <OverviewCards overview={data.overview} />
                        <div className="grid gap-6 xl:grid-cols-2">
                            <LoginChart trends={data.trends} />
                            <EventTrendsChart trends={data.trends} />
                        </div>
                        <SongRankingsTable songs={data.top_songs} />
                        <UserActivityTable users={data.user_activity} />
                        <RecentEventsTable events={data.recent_events} />
                    </>
                )}
            </PageContainer>
        </div>
    )
}

import { BarChart3 } from 'lucide-react'
import { PageHeader } from '@/components/shared/PageHeader'
import { DateRangePicker } from './DateRangePicker'
import { UserFilterSelect } from './UserFilterSelect'

interface DashboardHeaderProps {
    emails: string[]
}

export function DashboardHeader({ emails }: DashboardHeaderProps) {
    return (
        <PageHeader
            title="Analytics"
            subtitle="Internal BI dashboard for usage and adoption trends"
            icon={<BarChart3 size={24} />}
        >
            <div className="grid gap-3 lg:grid-cols-[minmax(0,2fr)_minmax(260px,1fr)]">
                <DateRangePicker />
                <UserFilterSelect emails={emails} />
            </div>
        </PageHeader>
    )
}

import { Navigate } from 'react-router-dom'
import { ROUTES } from '@/router/routes'
import { useAnalyticsAccess } from '../hooks/use-analytics-access'
import { BlockingErrorState } from '@/components/shared/BlockingErrorState'
import { LoadingSpinner } from '@/components/shared/LoadingSpinner'

interface AdminGuardProps {
    children: React.ReactNode
}

export function AdminGuard({ children }: AdminGuardProps) {
    const { isAllowed, isLoading, isError, refetch } = useAnalyticsAccess()

    if (isLoading) {
        return <LoadingSpinner size="lg" className="flex-1 min-h-screen" />
    }

    if (isError) {
        return (
            <BlockingErrorState
                title="Could not load analytics access"
                description="The app could not verify your admin access. Check your connection and try again."
                onRetry={() => void refetch()}
                retryTestId="analytics-guard-retry-button"
            />
        )
    }

    if (!isAllowed) {
        return <Navigate to={ROUTES.LIBRARY} replace />
    }

    return <>{children}</>
}

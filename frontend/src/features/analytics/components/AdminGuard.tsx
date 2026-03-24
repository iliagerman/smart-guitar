import { Navigate } from 'react-router-dom'
import { ROUTES } from '@/router/routes'
import { useAnalyticsAccess } from '../hooks/use-analytics-access'
import { LoadingSpinner } from '@/components/shared/LoadingSpinner'

export function useIsAdmin(): boolean {
    const { isAllowed } = useAnalyticsAccess()
    return isAllowed
}

export function AdminGuard({ children }: { children: React.ReactNode }) {
    const { isAllowed, isLoading } = useAnalyticsAccess()

    if (isLoading) {
        return <LoadingSpinner size="lg" className="flex-1 min-h-screen" />
    }

    if (!isAllowed) {
        return <Navigate to={ROUTES.LIBRARY} replace />
    }

    return <>{children}</>
}

import { Navigate } from 'react-router-dom'
import { ROUTES } from '@/router/routes'
import { useAnalyticsAccess } from '../hooks/use-analytics-access'

export function useIsAdmin(): boolean {
    const { isAllowed } = useAnalyticsAccess()
    return isAllowed
}

export function AdminGuard({ children }: { children: React.ReactNode }) {
    const { isAllowed, isLoading } = useAnalyticsAccess()

    if (isLoading) {
        return null
    }

    if (!isAllowed) {
        return <Navigate to={ROUTES.LIBRARY} replace />
    }

    return <>{children}</>
}

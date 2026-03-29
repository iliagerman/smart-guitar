import { Navigate } from 'react-router-dom'
import { ROUTES } from '@/router/routes'
import { useAnalyticsAccess } from '../hooks/use-analytics-access'
import { LoadingSpinner } from '@/components/shared/LoadingSpinner'

interface AdminGuardProps {
    children: React.ReactNode
}

export function AdminGuard({ children }: AdminGuardProps) {
    const { isAllowed, isLoading } = useAnalyticsAccess()

    if (isLoading) {
        return <LoadingSpinner size="lg" className="flex-1 min-h-screen" />
    }

    if (!isAllowed) {
        return <Navigate to={ROUTES.LIBRARY} replace />
    }

    return <>{children}</>
}

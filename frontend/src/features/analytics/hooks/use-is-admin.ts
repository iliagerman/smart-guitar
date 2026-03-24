import { useAnalyticsAccess } from './use-analytics-access'

export function useIsAdmin(): boolean {
    const { isAllowed } = useAnalyticsAccess()
    return isAllowed
}

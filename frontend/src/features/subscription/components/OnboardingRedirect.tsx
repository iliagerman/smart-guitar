import { Navigate } from 'react-router-dom'
import { useSubscriptionStore } from '@/stores/subscription.store'
import { songDetailPath } from '@/router/routes'

interface OnboardingRedirectProps {
  children: React.ReactNode
}

/**
 * Redirects first-time users (who haven't completed onboarding) to the
 * onboarding song. Renders children normally for returning users.
 */
export function OnboardingRedirect({ children }: OnboardingRedirectProps) {
  const status = useSubscriptionStore((s) => s.status)

  if (status && !status.has_seen_onboarding && status.onboarding_song_id) {
    return <Navigate to={songDetailPath(status.onboarding_song_id)} replace />
  }

  return <>{children}</>
}

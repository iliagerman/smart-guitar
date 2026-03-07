import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { CheckCircle } from 'lucide-react'
import { queryKeys } from '@/api/query-keys'
import { subscriptionApi } from '@/api/subscription.api'
import { ROUTES } from '@/router/routes'

export function SubscriptionSuccessPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [checking, setChecking] = useState(true)

  useEffect(() => {
    let attempts = 0
    const maxAttempts = 10

    const poll = async () => {
      try {
        const status = await subscriptionApi.getStatus()
        if (status.has_access) {
          queryClient.invalidateQueries({ queryKey: queryKeys.subscription.all })
          setChecking(false)
          setTimeout(() => navigate(ROUTES.LIBRARY, { replace: true }), 2000)
          return
        }
      } catch {
        // ignore errors during polling
      }

      attempts++
      if (attempts < maxAttempts) {
        setTimeout(poll, 2000)
      } else {
        setChecking(false)
        setTimeout(() => navigate(ROUTES.LIBRARY, { replace: true }), 2000)
      }
    }

    poll()
  }, [navigate, queryClient])

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
      <CheckCircle className="text-green-400" size={56} />
      <h1 className="text-2xl font-bold text-smoke-100">Payment Successful!</h1>
      <p className="text-smoke-400 text-center max-w-md">
        {checking
          ? 'Activating your subscription...'
          : 'Your subscription is active. Redirecting...'}
      </p>
      {checking && (
        <div className="h-8 w-8 rounded-full border-2 border-charcoal-600 border-t-flame-400 animate-spin" />
      )}
    </div>
  )
}

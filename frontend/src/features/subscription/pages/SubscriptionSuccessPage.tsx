import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { CheckCircle } from 'lucide-react'
import { queryKeys } from '@/api/query-keys'
import { subscriptionApi } from '@/api/subscription.api'
import { ROUTES } from '@/router/routes'
import { LoadingSpinner } from '@/components/shared/LoadingSpinner'

export function SubscriptionSuccessPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [checking, setChecking] = useState(true)

  useEffect(() => {
    let attempts = 0
    const maxAttempts = 10
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined

    const poll = async () => {
      if (cancelled) return
      try {
        const status = await subscriptionApi.getStatus()
        if (cancelled) return
        if (status.has_access) {
          queryClient.invalidateQueries({ queryKey: queryKeys.subscription.all })
          setChecking(false)
          timer = setTimeout(() => navigate(ROUTES.LIBRARY, { replace: true }), 2000)
          return
        }
      } catch {
        // ignore errors during polling
      }

      if (cancelled) return
      attempts++
      if (attempts < maxAttempts) {
        timer = setTimeout(poll, 2000)
      } else {
        setChecking(false)
        timer = setTimeout(() => navigate(ROUTES.LIBRARY, { replace: true }), 2000)
      }
    }

    poll()

    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
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
      {checking && <LoadingSpinner size="lg" />}
    </div>
  )
}

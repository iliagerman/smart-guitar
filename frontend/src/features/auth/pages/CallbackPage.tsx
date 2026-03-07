import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ROUTES } from '@/router/routes'
import { LoadingSpinner } from '@/components/shared/LoadingSpinner'
import { fetchAuthSession } from 'aws-amplify/auth'
import { useAuthStore } from '@/stores/auth.store'
import { getEmailFromIdToken } from '@/lib/jwt'

export function CallbackPage() {
  const navigate = useNavigate()
  const setTokens = useAuthStore((s) => s.setTokens)
  const setEmail = useAuthStore((s) => s.setEmail)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function run() {
      try {
        const params = new URLSearchParams(window.location.search)
        const oauthError = params.get('error')
        const oauthErrorDescription = params.get('error_description')

        if (oauthError) {
          const message = oauthErrorDescription || oauthError
          if (!cancelled) setError(message)
          return
        }

        // If someone lands here directly (no ?code=...), just go back to login.
        if (!params.get('code')) {
          navigate(ROUTES.LOGIN, { replace: true })
          return
        }

        const session = await fetchAuthSession()

        const accessToken = session.tokens?.accessToken?.toString()
        const idToken = session.tokens?.idToken?.toString()

        if (!accessToken || !idToken) {
          throw new Error('Missing tokens in auth session')
        }

        setTokens(accessToken, idToken, '')

        const email = getEmailFromIdToken(idToken)
        if (email) setEmail(email)

        // Remove the auth code from the URL.
        window.history.replaceState({}, document.title, ROUTES.CALLBACK)
        navigate(ROUTES.LIBRARY, { replace: true })
      } catch (e) {
        const message = e instanceof Error ? e.message : 'Google sign-in failed'
        if (!cancelled) setError(message)
      }
    }

    run()
    return () => {
      cancelled = true
    }
  }, [navigate, setEmail, setTokens])


  return (
    <div className="min-h-(--vv-height) flex items-center justify-center bg-charcoal-950">
      {error ? (
        <div className="max-w-sm w-full px-6 text-center">
          <p className="text-smoke-100 font-semibold mb-2">Sign-in failed</p>
          <p className="text-smoke-400 text-sm mb-6 wrap-break-word">{error}</p>
          <button
            type="button"
            onClick={() => navigate(ROUTES.LOGIN, { replace: true })}
            className="w-full py-3 bg-charcoal-700 border border-charcoal-600 text-smoke-100 font-semibold rounded-lg hover:border-smoke-500 transition-colors"
            data-testid="callback-back-to-login"
          >
            Back to sign in
          </button>
        </div>
      ) : (
        <LoadingSpinner />
      )}
    </div>
  )
}

import { useState } from 'react'
import axios from 'axios'
import { useMutation } from '@tanstack/react-query'
import { useLogin } from '../hooks/use-login'
import { Link, useNavigate } from 'react-router-dom'
import { ROUTES } from '@/router/routes'
import { signInWithRedirect } from 'aws-amplify/auth'
import { env } from '@/config/env'
import { authApi } from '@/api/auth.api'

function getErrorDetail(error: unknown): string | null {
  if (!axios.isAxiosError(error)) return null
  const detail = (error.response?.data as { detail?: unknown } | undefined)?.detail
  return typeof detail === 'string' ? detail : null
}

function isNotConfirmedError(error: unknown): boolean {
  return axios.isAxiosError(error) && error.response?.status === 403
}

export function LoginForm() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [googleError, setGoogleError] = useState<string | null>(null)
  const [googlePending, setGooglePending] = useState(false)
  const login = useLogin()
  const navigate = useNavigate()
  const resend = useMutation({
    mutationFn: () => authApi.resendCode(email),
    onSuccess: () => navigate(ROUTES.CONFIRM_EMAIL, { state: { email } }),
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    login.mutate({ email, password }, {
      onSuccess: () => navigate(ROUTES.LIBRARY),
    })
  }

  const handleGoogleSignIn = async () => {
    setGoogleError(null)

    if (!env.cognitoUserPoolId || !env.cognitoClientId || !env.cognitoDomain) {
      setGoogleError('Google sign-in is not configured for this environment.')
      return
    }

    try {
      setGooglePending(true)
      // Clear stale Amplify auth keys from localStorage (don't call signOut()
      // because it redirects to Cognito logout endpoint with OAuth configured)
      Object.keys(localStorage)
        .filter(k => k.startsWith('CognitoIdentityServiceProvider') || k.startsWith('amplify-'))
        .forEach(k => localStorage.removeItem(k))
      await signInWithRedirect({ provider: 'Google' })
    } catch (err) {
      setGooglePending(false)
      const msg = err instanceof Error ? err.message : String(err)
      setGoogleError(`Google sign-in failed: ${msg}`)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4 w-full" data-testid="login-form">
      <input
        id="login-email"
        name="email"
        type="email"
        placeholder="Email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className="w-full px-4 py-3 bg-charcoal-700 border border-charcoal-600 rounded-lg text-smoke-100 placeholder:text-smoke-600 focus:outline-none focus:ring-2 focus:ring-flame-400 transition-all"
        data-testid="login-email"
        required
      />
      <input
        id="login-password"
        name="password"
        type="password"
        placeholder="Password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        className="w-full px-4 py-3 bg-charcoal-700 border border-charcoal-600 rounded-lg text-smoke-100 placeholder:text-smoke-600 focus:outline-none focus:ring-2 focus:ring-flame-400 transition-all"
        data-testid="login-password"
        required
      />
      <button
        type="submit"
        disabled={login.isPending}
        className="w-full py-3 bg-flame-400 hover:bg-flame-500 text-charcoal-950 font-bold rounded-lg transition-colors disabled:opacity-50"
        data-testid="login-submit"
      >
        {login.isPending ? 'Signing in...' : 'Sign in'}
      </button>
      {login.isError && (
        <div className="flex flex-col gap-2" data-testid="login-error">
          <p className="text-red-500 text-sm text-center">
            {isNotConfirmedError(login.error)
              ? 'Your email is not confirmed yet.'
              : getErrorDetail(login.error) || 'Login failed'}
          </p>
          {isNotConfirmedError(login.error) && (
            <>
              <button
                type="button"
                disabled={resend.isPending}
                onClick={() => resend.mutate()}
                className="text-flame-400 hover:text-flame-500 text-sm transition-colors disabled:opacity-50"
                data-testid="resend-confirmation"
              >
                {resend.isPending ? 'Sending...' : 'Resend confirmation code'}
              </button>
              {resend.isError && (
                <p className="text-red-500 text-sm text-center">
                  {getErrorDetail(resend.error) || 'Failed to resend code'}
                </p>
              )}
            </>
          )}
        </div>
      )}
      <div className="relative flex items-center gap-4 my-2">
        <div className="flex-1 h-px bg-charcoal-600" />
        <div className="flex-1 h-px bg-charcoal-600" />
      </div>
      <button
        type="button"
        onClick={handleGoogleSignIn}
        disabled={googlePending}
        className="w-full py-3 bg-charcoal-700 border border-charcoal-600 text-smoke-100 font-semibold rounded-lg flex items-center justify-center gap-3 hover:border-smoke-500 transition-colors"
        data-testid="google-signin"
      >
        <svg width="18" height="18" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">
          <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" fill="#4285F4" />
          <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 009 18z" fill="#34A853" />
          <path d="M3.964 10.71A5.41 5.41 0 013.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 000 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" fill="#FBBC05" />
          <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 00.957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335" />
        </svg>
        {googlePending ? 'Redirecting…' : 'Sign in with Google'}
      </button>
      {googleError && (
        <p className="text-red-500 text-sm text-center" data-testid="google-signin-error">
          {googleError}
        </p>
      )}
      <p className="text-center text-smoke-400 text-sm mt-4">
        <Link to={ROUTES.REGISTER} className="text-flame-400 hover:text-flame-500 transition-colors" data-testid="create-account-link">
          Create account
        </Link>
      </p>
    </form>
  )
}

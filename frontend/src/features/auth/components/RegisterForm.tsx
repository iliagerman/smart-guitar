import { useState } from 'react'
import axios from 'axios'
import { useRegister } from '../hooks/use-register'
import { useGoogleSignIn } from '../hooks/use-google-signin'
import { Link, useNavigate } from 'react-router-dom'
import { ROUTES } from '@/router/routes'
import { trackEvent } from '@/lib/meta-pixel'

function getErrorDetail(error: unknown): string | null {
  if (!axios.isAxiosError(error)) return null
  const detail = (error.response?.data as { detail?: unknown } | undefined)?.detail
  return typeof detail === 'string' ? detail : null
}

export function RegisterForm() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [mismatchError, setMismatchError] = useState('')
  const register = useRegister()
  const navigate = useNavigate()
  const { googleError, googlePending, handleGoogleSignIn } = useGoogleSignIn()

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const normalizedEmail = email.trim()

    if (password !== confirmPassword) {
      setMismatchError('Passwords do not match')
      return
    }

    setMismatchError('')
    register.mutate(
      { email: normalizedEmail, password },
      {
        onSuccess: () => {
          trackEvent('CompleteRegistration')
          navigate(`${ROUTES.CONFIRM_EMAIL}?email=${encodeURIComponent(normalizedEmail)}`, { state: { email: normalizedEmail } })
        },
      },
    )
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4 w-full" data-testid="register-form">
      <input
        id="register-email"
        name="email"
        type="email"
        placeholder="Email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className="w-full px-4 py-3 bg-charcoal-700 border border-charcoal-600 rounded-lg text-smoke-100 placeholder:text-smoke-600 focus:outline-none focus:ring-2 focus:ring-flame-400 transition-shadow"
        data-testid="register-email"
        required
      />
      <input
        id="register-password"
        name="password"
        type="password"
        placeholder="Password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        className="w-full px-4 py-3 bg-charcoal-700 border border-charcoal-600 rounded-lg text-smoke-100 placeholder:text-smoke-600 focus:outline-none focus:ring-2 focus:ring-flame-400 transition-shadow"
        data-testid="register-password"
        required
      />
      <input
        id="register-confirm-password"
        name="confirmPassword"
        type="password"
        placeholder="Confirm password"
        value={confirmPassword}
        onChange={(e) => { setConfirmPassword(e.target.value); setMismatchError('') }}
        className="w-full px-4 py-3 bg-charcoal-700 border border-charcoal-600 rounded-lg text-smoke-100 placeholder:text-smoke-600 focus:outline-none focus:ring-2 focus:ring-flame-400 transition-shadow"
        data-testid="register-confirm-password"
        required
      />
      {mismatchError && (
        <p className="text-red-500 text-sm text-center">{mismatchError}</p>
      )}
      <button
        type="submit"
        disabled={register.isPending}
        className="w-full py-3 bg-flame-400 hover:bg-flame-500 text-charcoal-950 font-bold rounded-lg transition-colors disabled:opacity-50"
        data-testid="register-submit"
      >
        {register.isPending ? 'Creating account...' : 'Create account'}
      </button>
      {register.isError && (
        <p className="text-red-500 text-sm text-center" data-testid="register-error">
          {getErrorDetail(register.error) || 'Registration failed'}
        </p>
      )}
      <div className="relative flex items-center gap-4 my-2">
        <div className="flex-1 h-px bg-charcoal-600" />
        <div className="flex-1 h-px bg-charcoal-600" />
      </div>
      <button
        type="button"
        onClick={() => handleGoogleSignIn(trackEvent, 'CompleteRegistration')}
        disabled={googlePending}
        className="w-full py-3 bg-charcoal-700 border border-charcoal-600 text-smoke-100 font-semibold rounded-lg flex items-center justify-center gap-3 hover:border-smoke-500 transition-colors"
        data-testid="google-signup"
      >
        <svg width="18" height="18" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">
          <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" fill="#4285F4" />
          <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 009 18z" fill="#34A853" />
          <path d="M3.964 10.71A5.41 5.41 0 013.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 000 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" fill="#FBBC05" />
          <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 00.957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335" />
        </svg>
        {googlePending ? 'Redirecting...' : 'Sign up with Google'}
      </button>
      {googleError && (
        <p className="text-red-500 text-sm text-center" data-testid="google-signup-error">
          {googleError}
        </p>
      )}
      <p className="text-center text-smoke-400 text-sm mt-4">
        Already have an account?{' '}
        <Link to={ROUTES.LOGIN} className="text-flame-400 hover:text-flame-500 transition-colors" data-testid="login-link">
          Sign in
        </Link>
      </p>
    </form>
  )
}

import { useState } from 'react'
import axios from 'axios'
import { useRegister } from '../hooks/use-register'
import { Link, useNavigate } from 'react-router-dom'
import { ROUTES } from '@/router/routes'

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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (password !== confirmPassword) {
      setMismatchError('Passwords do not match')
      return
    }
    setMismatchError('')
    register.mutate({ email, password }, {
      onSuccess: () => navigate(ROUTES.CONFIRM_EMAIL, { state: { email } }),
    })
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
        className="w-full px-4 py-3 bg-charcoal-700 border border-charcoal-600 rounded-lg text-smoke-100 placeholder:text-smoke-600 focus:outline-none focus:ring-2 focus:ring-flame-400 transition-all"
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
        className="w-full px-4 py-3 bg-charcoal-700 border border-charcoal-600 rounded-lg text-smoke-100 placeholder:text-smoke-600 focus:outline-none focus:ring-2 focus:ring-flame-400 transition-all"
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
        className="w-full px-4 py-3 bg-charcoal-700 border border-charcoal-600 rounded-lg text-smoke-100 placeholder:text-smoke-600 focus:outline-none focus:ring-2 focus:ring-flame-400 transition-all"
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
      <p className="text-center text-smoke-400 text-sm mt-4">
        Already have an account?{' '}
        <Link to={ROUTES.LOGIN} className="text-flame-400 hover:text-flame-500 transition-colors">
          Sign in
        </Link>
      </p>
    </form>
  )
}

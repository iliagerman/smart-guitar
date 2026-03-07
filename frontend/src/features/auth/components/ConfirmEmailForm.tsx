import { useState } from 'react'
import axios from 'axios'
import { useMutation } from '@tanstack/react-query'
import { useConfirm } from '../hooks/use-confirm'
import { useNavigate, useLocation } from 'react-router-dom'
import { ROUTES } from '@/router/routes'
import { authApi } from '@/api/auth.api'

function getErrorDetail(error: unknown): string | null {
  if (!axios.isAxiosError(error)) return null
  const detail = (error.response?.data as { detail?: unknown } | undefined)?.detail
  return typeof detail === 'string' ? detail : null
}

export function ConfirmEmailForm() {
  const location = useLocation()
  const email = (location.state as { email?: string })?.email || ''
  const [code, setCode] = useState('')
  const [resendMsg, setResendMsg] = useState('')
  const confirm = useConfirm()
  const navigate = useNavigate()

  const resend = useMutation({
    mutationFn: () => authApi.resendCode(email),
    onSuccess: () => setResendMsg('Code resent! Check your email.'),
    onError: () => setResendMsg(''),
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    confirm.mutate({ email, confirmation_code: code }, {
      onSuccess: () => navigate(ROUTES.LOGIN),
    })
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4 w-full" data-testid="confirm-form">
      <p className="text-smoke-300 text-sm text-center">
        Enter the verification code sent to <span className="text-flame-400">{email}</span>
      </p>
      <input
        id="confirm-code"
        name="code"
        type="text"
        placeholder="Verification code"
        value={code}
        onChange={(e) => setCode(e.target.value)}
        className="w-full px-4 py-3 bg-charcoal-700 border border-charcoal-600 rounded-lg text-smoke-100 placeholder:text-smoke-600 focus:outline-none focus:ring-2 focus:ring-flame-400 transition-all text-center tracking-widest"
        data-testid="confirm-code"
        required
      />
      <button
        type="submit"
        disabled={confirm.isPending}
        className="w-full py-3 bg-flame-400 hover:bg-flame-500 text-charcoal-950 font-bold rounded-lg transition-colors disabled:opacity-50"
        data-testid="confirm-submit"
      >
        {confirm.isPending ? 'Confirming...' : 'Confirm email'}
      </button>
      {confirm.isError && (
        <p className="text-red-500 text-sm text-center">
          {getErrorDetail(confirm.error) || 'Confirmation failed'}
        </p>
      )}
      <button
        type="button"
        disabled={resend.isPending}
        onClick={() => resend.mutate()}
        className="text-smoke-400 hover:text-flame-400 text-sm transition-colors disabled:opacity-50"
        data-testid="resend-code"
      >
        {resend.isPending ? 'Resending...' : "Didn't get the code? Resend"}
      </button>
      {resendMsg && (
        <p className="text-green-400 text-sm text-center">{resendMsg}</p>
      )}
      {resend.isError && (
        <p className="text-red-500 text-sm text-center">
          {getErrorDetail(resend.error) || 'Failed to resend code'}
        </p>
      )}
    </form>
  )
}

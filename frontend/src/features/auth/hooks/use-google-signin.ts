import { useState } from 'react'
import { signInWithRedirect } from 'aws-amplify/auth'
import { env } from '@/config/env'

interface UseGoogleSignInResult {
  googleError: string | null
  googlePending: boolean
  handleGoogleSignIn: (trackFn?: (event: string, params?: Record<string, unknown>) => void, eventName?: string) => Promise<void>
}

export function useGoogleSignIn(): UseGoogleSignInResult {
  const [googleError, setGoogleError] = useState<string | null>(null)
  const [googlePending, setGooglePending] = useState(false)

  const handleGoogleSignIn = async (
    trackFn?: (event: string, params?: Record<string, unknown>) => void,
    eventName?: string,
  ) => {
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
      if (trackFn && eventName) {
        trackFn(eventName, { method: 'google' })
      }
      await signInWithRedirect({ provider: 'Google' })
    } catch (err) {
      setGooglePending(false)
      const msg = err instanceof Error ? err.message : String(err)
      setGoogleError(`Google sign-in failed: ${msg}`)
    }
  }

  return { googleError, googlePending, handleGoogleSignIn }
}

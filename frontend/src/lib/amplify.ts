import { Amplify } from 'aws-amplify'
import { env } from '@/config/env'

let configured = false

function normalizeDomain(domain: string): string {
    return domain.replace(/^https?:\/\//, '').replace(/\/+$/, '')
}

function regionFromUserPoolId(userPoolId: string): string {
    const region = userPoolId.split('_')[0]
    return region || 'us-east-1'
}

/**
 * Configure Amplify Auth for Cognito Hosted UI (Google OAuth).
 *
 * This must run once in the browser before calling `signInWithRedirect()`.
 */
export function initAmplifyAuth(): void {
    if (configured) return

    const userPoolId = env.cognitoUserPoolId
    const clientId = env.cognitoClientId
    const domain = normalizeDomain(env.cognitoDomain)

    if (!userPoolId || !clientId || !domain) {
        // Keep the app usable for local development without Cognito configured.
        // The Google sign-in button will surface a friendly error.
        console.warn('[auth] Cognito env vars missing; Google OAuth disabled')
        configured = true
        return
    }

    const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:5173'
    const redirectSignIn = `${origin}/callback`
    const redirectSignOut = origin

    Amplify.configure({
        Auth: {
            Cognito: {
                userPoolId,
                userPoolClientId: clientId,
                // Region is derived from the user pool id (e.g. us-east-1_XXXX)
                userPoolEndpoint: `https://cognito-idp.${regionFromUserPoolId(userPoolId)}.amazonaws.com/`,
                loginWith: {
                    oauth: {
                        domain,
                        scopes: ['openid', 'email', 'profile'],
                        redirectSignIn: [redirectSignIn],
                        redirectSignOut: [redirectSignOut],
                        responseType: 'code',
                    },
                },
            },
        },
    })

    configured = true
}

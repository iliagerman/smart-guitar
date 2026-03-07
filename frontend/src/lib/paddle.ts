// Store state on window so it survives Vite HMR (module-level variables
// get reset when the module hot-reloads, but the Paddle event callback
// registered in the first Initialize() call still references the old closure).

export function initPaddle(clientToken: string, environment: string) {
  if (window.__paddleInitialized) return
  if (typeof window === 'undefined' || !window.Paddle) {
    console.warn('[Paddle] window.Paddle not available — script may not have loaded')
    return
  }

  try {
    window.Paddle.Environment.set(environment as 'sandbox' | 'production')
    window.Paddle.Initialize({
      token: clientToken,
      eventCallback: (event: PaddleEvent) => {
        if (event.name === 'checkout.completed') {
          const txnId =
            (event.data as Record<string, unknown>)?.transaction_id as string | undefined
          window.__paddleCheckoutSuccess?.(txnId ?? null)
          window.__paddleCheckoutSuccess = null
        }
        if (event.name === 'checkout.error') {
          console.error('[Paddle] checkout error:', event)
        }
      },
    })
    window.__paddleInitialized = true
  } catch (err) {
    console.error('[Paddle] Initialize failed:', err)
  }
}

export function openPaddleCheckout(options: {
  priceId: string
  customerEmail: string
  customData: Record<string, string>
  onSuccess: (transactionId: string | null) => void
}) {
  if (!window.Paddle) {
    console.error('[Paddle] Paddle.js not loaded — is the script tag in index.html?')
    return
  }

  if (!window.__paddleInitialized) {
    console.error('[Paddle] Paddle not initialized — check initPaddle() and client_token')
    return
  }

  window.__paddleCheckoutSuccess = options.onSuccess

  const checkoutConfig = {
    items: [{ priceId: options.priceId, quantity: 1 }],
    customer: { email: options.customerEmail },
    customData: options.customData,
    settings: {
      displayMode: 'overlay' as const,
      theme: 'dark' as const,
    },
  }

  try {
    window.Paddle.Checkout.open(checkoutConfig)
  } catch (err) {
    console.error('[Paddle] Checkout.open() failed:', err)
  }
}

// Type declarations for Paddle.js v2
interface PaddleEvent {
  name: string
  data?: unknown
}

declare global {
  interface Window {
    __paddleInitialized?: boolean
    __paddleCheckoutSuccess?: ((transactionId: string | null) => void) | null
    Paddle: {
      Environment: {
        set: (env: 'sandbox' | 'production') => void
      }
      Initialize: (options: {
        token: string
        eventCallback?: (event: PaddleEvent) => void
      }) => void
      Checkout: {
        open: (options: {
          items: { priceId: string; quantity: number }[]
          customer?: { email: string }
          customData?: Record<string, string>
          settings?: {
            displayMode?: 'overlay' | 'inline'
            theme?: 'light' | 'dark'
            successUrl?: string
          }
        }) => void
      }
    }
  }
}

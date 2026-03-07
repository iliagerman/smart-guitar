import { useState, useEffect } from 'react'
import { X, Download, Share } from 'lucide-react'

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

const DISMISSED_KEY = 'pwa-install-dismissed'
const DISMISS_DURATION_MS = 7 * 24 * 60 * 60 * 1000 // 7 days

function wasDismissedRecently(): boolean {
  const dismissed = localStorage.getItem(DISMISSED_KEY)
  if (!dismissed) return false
  return Date.now() - Number(dismissed) < DISMISS_DURATION_MS
}

function isIos(): boolean {
  return /iphone|ipad|ipod/i.test(navigator.userAgent)
}

function isInStandaloneMode(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    ('standalone' in navigator && (navigator as { standalone?: boolean }).standalone === true)
  )
}

export function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [showIosBanner] = useState(() => {
    if (isInStandaloneMode() || wasDismissedRecently()) return false
    return isIos()
  })
  const [visible, setVisible] = useState(() => {
    if (isInStandaloneMode() || wasDismissedRecently()) return false
    return isIos()
  })

  useEffect(() => {
    if (isInStandaloneMode() || wasDismissedRecently()) return

    // Android / Chrome: capture the beforeinstallprompt event
    const handler = (e: Event) => {
      e.preventDefault()
      setDeferredPrompt(e as BeforeInstallPromptEvent)
      setVisible(true)
    }
    window.addEventListener('beforeinstallprompt', handler)

    return () => window.removeEventListener('beforeinstallprompt', handler)
  }, [])

  const dismiss = () => {
    setVisible(false)
    localStorage.setItem(DISMISSED_KEY, String(Date.now()))
  }

  const install = async () => {
    if (!deferredPrompt) return
    await deferredPrompt.prompt()
    const { outcome } = await deferredPrompt.userChoice
    if (outcome === 'accepted') {
      setVisible(false)
    }
    setDeferredPrompt(null)
  }

  if (!visible) return null

  return (
    <div className="fixed bottom-4 left-4 right-4 z-50 mx-auto max-w-md animate-slide-up">
      <div className="flex items-start gap-3 rounded-2xl border border-charcoal-700 bg-charcoal-900/95 p-4 shadow-lg backdrop-blur-sm">
        <img
          src="/icons/icon-192x192.png"
          alt="Smart Guitar"
          className="h-12 w-12 shrink-0 rounded-xl"
        />

        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-smoke-100">Install Smart Guitar</p>

          {showIosBanner ? (
            <p className="mt-0.5 text-xs text-smoke-400">
              Tap <Share className="inline h-3.5 w-3.5 align-text-bottom text-fire-400" /> then{' '}
              <span className="font-medium text-smoke-300">"Add to Home Screen"</span>
            </p>
          ) : (
            <>
              <p className="mt-0.5 text-xs text-smoke-400">
                Add to your home screen for quick access
              </p>
              <button
                onClick={install}
                className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-fire-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-fire-500 active:bg-fire-700"
              >
                <Download className="h-3.5 w-3.5" />
                Install
              </button>
            </>
          )}
        </div>

        <button
          onClick={dismiss}
          className="shrink-0 rounded-lg p-1 text-smoke-500 transition-colors hover:bg-charcoal-700 hover:text-smoke-300"
          aria-label="Dismiss install prompt"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}
